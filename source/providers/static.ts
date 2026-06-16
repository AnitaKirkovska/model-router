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

/** Vellum's built-in profiles, mapped to categories. A sensible default. */
export const VELLUM_PROFILE_MAP: Record<Category, string> = {
  chat: "cost-optimized",
  research: "balanced",
  deep: "quality-optimized",
};
