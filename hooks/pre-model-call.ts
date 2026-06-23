import type { PreModelCallContext } from "@vellumai/plugin-api";
import { getModelProfiles } from "@vellumai/plugin-api";
import { classify } from "../source/core/classifier.js";
import {
  supportsVision,
  hasImage,
  textFromContent,
} from "../source/core/vision.js";

type Profile = {
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

function profileText(profile: Profile): string {
  return [profile.key, profile.label, profile.name, profile.model]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isEnabled(profile: Profile): boolean {
  if (profile.isDisabled) return false;
  const status = String(profile.status ?? "").toLowerCase();
  return status !== "disabled";
}

function pickProfile(category: string, profiles: Profile[]): string | undefined {
  const hints = PROFILE_HINTS[category] ?? [];
  for (const hint of hints) {
    if (hint.keys?.length) {
      const byKey = profiles.find((p) => hint.keys!.includes(String(p.key)));
      if (byKey?.key) return byKey.key;
    }
    if (hint.text?.length) {
      const byText = profiles.find((p) => {
        const text = profileText(p);
        return hint.text!.some((needle) => text.includes(needle));
      });
      if (byText?.key) return byText.key;
    }
  }
  return undefined;
}

function latestUserMessage(ctx: any): any | undefined {
  const messageLists = [
    ctx.latestMessages,
    ctx.messages,
    ctx.inputMessages,
    ctx.request?.messages,
  ].filter(Array.isArray);

  for (const messages of messageLists) {
    const lastUser = [...messages].reverse().find((m: any) => m?.role === "user");
    if (lastUser) return lastUser;
  }
  return undefined;
}

/**
 * Route user-facing model calls to the strongest available profile for the
 * task at hand. Background calls are left alone.
 *
 * Image-bearing turns are routed to a vision-capable profile so an image
 * never lands on a text-only model (e.g. an open fast model that rejects
 * image input). If no vision-capable profile is enabled, the hook no-ops
 * and the platform default runs unchanged.
 */
export default async function preModelCall(
  ctx: PreModelCallContext,
): Promise<void> {
  const anyCtx = ctx as any;
  if (anyCtx.callSite && anyCtx.callSite !== "mainAgent") return;

  const lastUser = latestUserMessage(anyCtx);
  const content = lastUser?.content;

  const text = textFromContent(content) || (typeof anyCtx.userPrompt === "string" ? anyCtx.userPrompt : "");
  const imageTurn = hasImage(content);

  // Need either text to classify or an image to route on.
  if (!text.trim() && !imageTurn) return;

  const profiles = getModelProfiles() as Profile[];
  if (!Array.isArray(profiles) || profiles.length === 0) return;

  const enabled = profiles.filter((p) => p.key && isEnabled(p));

  let pick: string | undefined;
  if (imageTurn) {
    // Constrain to vision-capable profiles, then pick a strong multimodal one.
    const visionPool = enabled.filter(supportsVision);
    pick = pickProfile("vision", visionPool);
    // Last resort: any enabled vision-capable profile at all.
    if (!pick) pick = visionPool[0]?.key;
  } else {
    const { category } = classify(text);
    pick = pickProfile(category, enabled);
  }

  if (!pick) return;
  anyCtx.modelProfile = pick;
}
