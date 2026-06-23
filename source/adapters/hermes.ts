// ─── Hermes harness adapter (advisory only) ──────────────────────────────────
// Hermes's pre_llm_call hook can ONLY inject context text into the user
// message. There is no plugin-writable "active model" property and no
// model-switch hook. Automatic per-turn routing is architecturally impossible
// in Hermes's current design.
//
// What this adapter provides:
//   1. A recommender helper that takes a turn and a list of models, runs it
//      through the harness-neutral core, and returns a human-readable
//      suggestion string — suitable for injection via pre_llm_call's
//      `{"context": str}` return value.
//   2. An advisory-only /route command string (to be wired to a
//      ctx.register_cli_command or ctx.register_command in your Python plugin).
//
// To do real per-model routing from a Hermes plugin you need ctx.llm.complete()
// with allow_model_override: true in config.yaml — that is a trust-gated
// side-channel LLM call, not a main-agent model switch.

import { chooseProfileForTurn, type SelectableProfile } from "../core/selection.js";

export interface HermesRecommendInput {
  text: string;
  hasImageTurn: boolean;
  /** Available model refs as simple strings, e.g. ["anthropic/claude-opus-4", "openai/gpt-4o"]. */
  modelRefs: string[];
}

export interface HermesRecommendResult {
  /** The recommended model ref (provider/model), or undefined if no clear pick. */
  recommendedRef?: string;
  /** Human-readable advisory context string, suitable for injection into pre_llm_call. */
  advisoryContext: string;
}

/**
 * Run the core selector over a Hermes model list and return an advisory
 * recommendation. Inject `result.advisoryContext` into your plugin's
 * `pre_llm_call` return value to give the model a hint about routing.
 *
 * NOTE: This does NOT switch the active model. The main agent model stays
 * whatever the user or config has set. This is advisory context only.
 */
export function hermesRecommend(
  input: HermesRecommendInput,
): HermesRecommendResult {
  // Translate bare model refs into SelectableProfile shapes the core can rank.
  const profiles: SelectableProfile[] = input.modelRefs.map((ref) => {
    const [provider, ...parts] = ref.split("/");
    const modelId = parts.join("/");
    return {
      key: ref,
      model: modelId,
      label: ref,
      name: ref,
      // Unknown models default to not-vision-capable (the safe choice).
      supportsVision: undefined,
    };
  });

  const decision = chooseProfileForTurn({
    text: input.text,
    hasImageTurn: input.hasImageTurn,
    profiles,
  });

  if (!decision.profileKey) {
    return {
      advisoryContext:
        "No specific model recommendation for this turn; use the configured default.",
    };
  }

  const advisoryContext = `[Router Advisory] For this turn (${decision.category}), suggested model: ${decision.profileKey}. Reason: ${decision.reason}`;
  return { recommendedRef: decision.profileKey, advisoryContext };
}
