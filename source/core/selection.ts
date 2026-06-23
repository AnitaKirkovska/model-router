// === Profile selection: harness-agnostic core ================================
//    Given the text + image state of a turn and a set of available profiles, pick
//    the strongest enabled profile for the job. No harness imports here. The
//    Vellum hook (and future OpenClaw adapters) are thin wrappers that feed this
//    function and apply its result.

import { classify } from "./classifier.js";
import { supportsVision, hasImage, textFromContent } from "./vision.js";

export type SelectableProfile = {
  key?: string;
  label?: string;
  name?: string;
  model?: string;
  status?: string;
  isDisabled?: boolean;
  supportsVision?: boolean;
  vision?: boolean;
  capabilities?: { vision?: boolean };
};

export type SelectionCategory = "chat" | "research" | "deep" | "vision" | "noop";

export interface ChooseProfileInput {
  /** Text of the latest user message (already extracted from content blocks). */
  text: string;
  /** Whether the latest user message carries an image block. */
  hasImageTurn: boolean;
  /** Available profiles from the harness. */
  profiles: SelectableProfile[];
}

export interface ChooseProfileResult {
  /** The profile key to route to, or undefined to no-op. */
  profileKey?: string;
  /** What category drove the decision. */
  category: SelectionCategory;
  /** Human-readable reason for logging / debugging. */
  reason: string;
}

type ProfileHint = {
  keys?: string[];
  text?: string[];
};

const PROFILE_HINTS: Record<string, ProfileHint[]> = {
  chat: [
    { text: ["speed", "fast", "haiku"] },
    { text: ["sonnet"] },
    { keys: ["cost-optimized", "balanced"] },
  ],
  research: [
    { text: ["quality", "glm", "gpt", "opus", "fable"] },
    { keys: ["balanced", "auto"] },
  ],
  deep: [
    { text: ["frontier", "fable", "opus"] },
    { text: ["quality", "glm", "gpt"] },
    { keys: ["quality-optimized", "balanced", "auto"] },
  ],
  // Image turns: route to a strong multimodal profile. The vision-capability
  // filter is enforced separately, so every candidate here is already known
  // to accept images.
  vision: [
    { text: ["opus", "fable", "gpt", "gemini", "sonnet", "claude"] },
    { keys: ["quality-optimized", "claude-4.8-high", "balanced", "auto"] },
  ],
};

function profileText(profile: SelectableProfile): string {
  return [profile.key, profile.label, profile.name, profile.model]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isEnabled(profile: SelectableProfile): boolean {
  if (profile.isDisabled) return false;
  const status = String(profile.status ?? "").toLowerCase();
  return status !== "disabled";
}

function pickProfile(
  category: string,
  profiles: SelectableProfile[],
): string | undefined {
  const hints = PROFILE_HINTS[category] ?? [];
  for (const hint of hints) {
    if (hint.keys?.length) {
      const byKey = profiles.find((p) => hint.keys!.includes(String(p.key)));
      if (byKey?.key) return byKey.key;
    }
    if (hint.text?.length) {
      for (const needle of hint.text) {
        const byText = profiles.find((p) => profileText(p).includes(needle));
        if (byText?.key) return byText.key;
      }
    }
  }
  return undefined;
}

/**
 * Find the latest user message in a standard message array (role/content).
 * Returns its content (string or block array) or undefined.
 */
export function latestUserContent(messages: unknown): unknown {
  if (!Array.isArray(messages)) return undefined;
  const lastUser = [...messages]
    .reverse()
    .find((m: any) => m?.role === "user");
  return lastUser?.content;
}

/**
 * Extract text + image presence from any combination of message arrays a
 * harness might expose. Pass every array you can find; the first user message
 * in the first non-empty array wins.
 */
export function extractTurn(messageArrays: unknown[]): {
  text: string;
  hasImageTurn: boolean;
} {
  for (const messages of messageArrays) {
    if (!Array.isArray(messages)) continue;
    const content = latestUserContent(messages);
    if (content === undefined) continue;
    const text = textFromContent(content);
    const image = hasImage(content);
    if (text.trim() || image) return { text, hasImageTurn: image };
  }
  return { text: "", hasImageTurn: false };
}

/**
 * The core decision: given the turn's text + image state and the available
 * profiles, return the best profile key to route to (or undefined to no-op).
 */
export function chooseProfileForTurn(
  input: ChooseProfileInput,
): ChooseProfileResult {
  const { text, hasImageTurn, profiles } = input;

  if (!text.trim() && !hasImageTurn) {
    return { category: "noop", reason: "empty turn (no text, no image)" };
  }

  if (!Array.isArray(profiles) || profiles.length === 0) {
    return { category: "noop", reason: "no profiles available" };
  }

  const enabled = profiles.filter((p) => p.key && isEnabled(p));
  if (enabled.length === 0) {
    return { category: "noop", reason: "no enabled profiles" };
  }

  // Image turn: constrain to vision-capable profiles only.
  if (hasImageTurn) {
    const visionPool = enabled.filter(supportsVision);
    if (visionPool.length === 0) {
      return {
        category: "noop",
        reason: "image turn but no vision-capable profile enabled",
      };
    }
    let pick = pickProfile("vision", visionPool);
    if (!pick) pick = visionPool[0]?.key; // last resort: any vision profile
    if (!pick) {
      return { category: "noop", reason: "vision pool non-empty but no key" };
    }
    return { profileKey: pick, category: "vision", reason: "image turn routed to vision-capable profile" };
  }

  // Text turn: classify, then pick the strongest profile for the category.
  const { category } = classify(text);
  const pick = pickProfile(category, enabled);
  if (!pick) {
    return { category: "noop", reason: `category ${category} matched no profile` };
  }
  return { profileKey: pick, category, reason: `text turn classified as ${category}` };
}
