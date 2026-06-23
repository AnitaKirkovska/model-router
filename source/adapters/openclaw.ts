// ─── OpenClaw harness adapter (to-spec) ──────────────────────────────────────
// Maps a ChooseProfileResult onto OpenClaw's `before_model_resolve` hook,
// which returns `{ providerOverride, modelOverride }`. The core selection
// logic is in source/core/selection.ts; this adapter only handles the shape
// translation between Vellum-style profiles (key/label/model) and OpenClaw's
// `provider/modelId` ref format.
//
// Status: to-spec, pending live smoke test against an OpenClaw gateway.
// Built from the openclaw-research subagent's confirmed API surface:
//   - `before_model_resolve` hook → return `{ providerOverride, modelOverride }`
//   - Model ref format: `provider/modelId`
//   - Provider catalog models carry `input: ["text", "image"]` for vision

import { chooseProfileForTurn, type SelectableProfile } from "../core/selection.js";

/** An OpenClaw catalog model, per `api.registerProvider` catalog shape. */
export interface OpenClawModel {
  id: string;
  name?: string;
  input?: ("text" | "image")[];
  reasoning?: boolean;
  cost?: { prompt?: number; completion?: number };
  contextWindow?: number;
  maxTokens?: number;
}

/**
 * OpenClaw profiles expose models via a provider catalog. Translate each
 * catalog model into the SelectableProfile shape the core selector expects.
 * A model is vision-capable when its `input` array includes "image".
 */
export function openClawModelToProfile(
  providerId: string,
  model: OpenClawModel,
  isDisabled = false,
): SelectableProfile {
  const key = `${providerId}/${model.id}`;
  return {
    key,
    label: model.name,
    name: model.name,
    model: model.id,
    status: isDisabled ? "disabled" : undefined,
    isDisabled,
    // OpenClaw catalog carries an explicit input array; set the vision flag from it.
    supportsVision: model.input?.includes("image") ?? false,
  };
}

export interface BeforeModelResolveResult {
  providerOverride?: string;
  modelOverride?: string;
  /** Optional, for the plugin to log why a route happened. */
  reason?: string;
}

/**
 * Apply a core selection decision to OpenClaw's `before_model_resolve` hook.
 * The hook handler reads the turn's messages + the provider catalog, calls
 * the core selector, and returns this result. provider/model split from the
 * chosen profile key (which is `provider/modelId` in OpenClaw's format).
 */
export function applySelectionToOpenClaw(
  decision: ReturnType<typeof chooseProfileForTurn>,
): BeforeModelResolveResult {
  if (!decision.profileKey) return {}; // no-op, let OpenClaw's default run
  const [provider, ...modelParts] = decision.profileKey.split("/");
  const modelOverride = modelParts.join("/");
  return {
    providerOverride: provider,
    modelOverride,
    reason: decision.reason,
  };
}
