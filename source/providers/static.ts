import type { Category, ModelProvider, Tier } from "../core/types.js";
import { CATEGORY_TIER } from "../core/types.js";

/**
 * Maps each category to a fixed model/profile id. Used when the harness has
 * its own named profiles (e.g. Vellum's "cost-optimized" / "balanced" /
 * "quality-optimized") rather than raw model ids.
 */
export class StaticProvider implements ModelProvider {
  readonly name = "static";
  constructor(private map: Record<Category, string>) {}

  async resolve(
    category: Category,
  ): Promise<{ modelId: string; modelName?: string; tier: Tier }> {
    const modelId = this.map[category];
    if (!modelId) throw new Error(`No static mapping for category "${category}"`);
    return { modelId, modelName: modelId, tier: CATEGORY_TIER[category] };
  }
}

/**
 * Vellum's current profiles, mapped to categories.
 *
 * Profile inventory rotates (Quality re-pointed to GLM 5.2 on Jun 22 2026,
 * a new Frontier profile added for Opus and Fable). These keys track the
 * live workspace config:
 *   chat     → notch-fast (Sonnet, snappy)        fallback cost-optimized
 *   research → claude-4.8-high (Quality-Claude)  fallback balanced
 *   deep     → claude-fable-5-high (Frontier)    fallback quality-optimized
 *
 * The hook resolves the first *enabled* key per category, so a disabled
 * profile simply falls through to the next entry instead of breaking.
 */
export const VELLUM_PROFILE_MAP: Record<Category, string> = {
  chat: "notch-fast",
  research: "claude-4.8-high",
  deep: "claude-fable-5-high",
};
