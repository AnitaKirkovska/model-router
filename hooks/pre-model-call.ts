import type { PreModelCallContext } from "@vellumai/plugin-api";
import { getModelProfiles } from "@vellumai/plugin-api";
import {
  chooseProfileForTurn,
  extractTurn,
  type SelectableProfile,
} from "../source/core/selection.js";

/**
 * Vellum harness adapter. The harness-neutral core does the routing; this hook
 * is a thin wrapper that reads Vellum's live profiles, feeds the turn through
 * the core selector, and writes the result back to Vellum's writable
 * `ctx.modelProfile`.
 *
 * Only routes `mainAgent` calls. Background calls are left alone.
 */
export default async function preModelCall(
  ctx: PreModelCallContext,
): Promise<void> {
  const anyCtx = ctx as any;
  if (anyCtx.callSite && anyCtx.callSite !== "mainAgent") return;

  const { text, hasImageTurn } = extractTurn([
    anyCtx.latestMessages,
    anyCtx.messages,
    anyCtx.inputMessages,
    anyCtx.request?.messages,
  ]);
  // Fallback: some call sites expose a flat userPrompt string instead of a message array.
  const finalText = text || (typeof anyCtx.userPrompt === "string" ? anyCtx.userPrompt : "");

  const profiles = getModelProfiles() as SelectableProfile[];
  const decision = chooseProfileForTurn({
    text: finalText,
    hasImageTurn,
    profiles,
  });

  if (decision.profileKey) anyCtx.modelProfile = decision.profileKey;
}
