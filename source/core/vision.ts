// ─── Vision / multimodal routing helpers ─────────────────────────────────────
// Pure, harness-agnostic. The pre-model-call hook uses these to keep image
// turns off text-only models.

export type ProfileLike = {
  key?: string;
  label?: string;
  name?: string;
  model?: string;
  supportsVision?: boolean;
  vision?: boolean;
  capabilities?: { vision?: boolean };
};

// Model families known to accept image input. Used ONLY as a fallback when a
// profile exposes no explicit vision flag.
export const KNOWN_VISION =
  /(opus|sonnet|haiku|claude|fable|gpt-4o|gpt-4\.|gpt-5|gemini|pixtral|llama-3\.2|qwen[\w-]*vl|[\w-]*-vl\b|vision|kimi)/i;

export function profileText(profile: ProfileLike): string {
  return [profile.key, profile.label, profile.name, profile.model]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * Whether a profile can accept image input. Prefer the explicit flag exposed
 * by the harness; fall back to a known-multimodal-family heuristic only when
 * no flag is present. When nothing is known, treat as NOT vision-capable so an
 * image never gets routed to a model that might reject it.
 */
export function supportsVision(profile: ProfileLike): boolean {
  const flag =
    profile.supportsVision ?? profile.vision ?? profile.capabilities?.vision;
  if (typeof flag === "boolean") return flag;
  return KNOWN_VISION.test(profileText(profile));
}

function blocksOf(content: unknown): any[] {
  return Array.isArray(content) ? content : [];
}

/** True if the message content carries at least one image block. */
export function hasImage(content: unknown): boolean {
  return blocksOf(content).some((block: any) => {
    if (!block || typeof block !== "object") return false;
    const type = String(block.type ?? "").toLowerCase();
    return (
      type === "image" ||
      type === "image_url" ||
      type === "input_image" ||
      !!block.image ||
      !!block.image_url ||
      !!block.source?.type
    );
  });
}

/** Extract the plain text from a message's content (string or block array). */
export function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  return blocksOf(content)
    .map((block: any) => {
      if (typeof block === "string") return block;
      if (block?.type === "text" && typeof block.text === "string") return block.text;
      if (typeof block?.text === "string") return block.text;
      return "";
    })
    .filter(Boolean)
    .join(" ");
}
