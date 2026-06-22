import type { PreModelCallContext } from "@vellumai/plugin-api";
import { getModelProfiles } from "@vellumai/plugin-api";
import { classify } from "../source/core/classifier.js";

type Profile = {
  key?: string;
  label?: string;
  name?: string;
  model?: string;
  status?: string;
  isDisabled?: boolean;
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
  const enabled = profiles.filter((p) => p.key && isEnabled(p));
  const hints = PROFILE_HINTS[category] ?? [];

  for (const hint of hints) {
    if (hint.keys?.length) {
      const byKey = enabled.find((p) => hint.keys!.includes(String(p.key)));
      if (byKey?.key) return byKey.key;
    }

    if (hint.text?.length) {
      const byText = enabled.find((p) => {
        const text = profileText(p);
        return hint.text!.some((needle) => text.includes(needle));
      });
      if (byText?.key) return byText.key;
    }
  }

  return undefined;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block: any) => {
      if (typeof block === "string") return block;
      if (block?.type === "text" && typeof block.text === "string") return block.text;
      if (typeof block?.text === "string") return block.text;
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

function latestUserText(ctx: any): string {
  const messageLists = [
    ctx.latestMessages,
    ctx.messages,
    ctx.inputMessages,
    ctx.request?.messages,
  ].filter(Array.isArray);

  for (const messages of messageLists) {
    const lastUser = [...messages].reverse().find((m: any) => m?.role === "user");
    const text = textFromContent(lastUser?.content);
    if (text.trim()) return text;
  }

  for (const value of [ctx.userPrompt, ctx.prompt, ctx.input]) {
    if (typeof value === "string" && value.trim()) return value;
  }

  return "";
}

/**
 * Route user-facing model calls to the strongest available profile for the
 * task at hand. Background calls are left alone.
 *
 * The hook is deliberately defensive: if the host does not expose messages,
 * profiles, or writable modelProfile yet, it no-ops and the platform default
 * runs unchanged.
 */
export default async function preModelCall(
  ctx: PreModelCallContext,
): Promise<void> {
  const anyCtx = ctx as any;
  if (anyCtx.callSite && anyCtx.callSite !== "mainAgent") return;

  const text = latestUserText(anyCtx);
  if (!text.trim()) return;

  const profiles = getModelProfiles() as Profile[];
  if (!Array.isArray(profiles) || profiles.length === 0) return;

  const { category } = classify(text);
  const pick = pickProfile(category, profiles);
  if (!pick) return;

  anyCtx.modelProfile = pick;
}
