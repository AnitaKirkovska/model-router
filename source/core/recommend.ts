import type { ModelInfo, Tier } from "./types.js";

/**
 * Family reputation tiers. This is hand-curated real-world knowledge of which
 * orgs ship strong, agentic-capable models — NOT a live benchmark. It is the
 * honest part of "best": the API exposes no quality score, so we encode the
 * reputation of the org that built the model, then tie-break on recency and
 * context window.
 *
 * Lower number = stronger reputation.
 */
const FAMILY_RANK: Record<string, number> = {
  // S-tier frontier labs
  anthropic: 0,
  openai: 0,
  google: 0,
  "x-ai": 1,
  deepseek: 1,
  // A-tier — strong open + proprietary
  qwen: 2,
  "meta-llama": 2,
  mistralai: 2,
  moonshotai: 2,
  "z-ai": 2,
  minimax: 2,
  nvidia: 3,
  cohere: 3,
  amazon: 3,
  microsoft: 3,
  perplexity: 3,
  "ibm-granite": 3,
  ai21: 3,
  baidu: 3,
  tencent: 3,
  bytedance: 3,
  "bytedance-seed": 3,
};
const DEFAULT_RANK = 5;

function familyOf(id: string): string {
  return id.split("/")[0].replace(/^~/, "");
}

function reputation(id: string): number {
  return FAMILY_RANK[familyOf(id)] ?? DEFAULT_RANK;
}

/**
 * Rank models within a pool. Best first.
 * Order: reputation (asc) → recency (desc) → context length (desc) → price (asc).
 */
export function rankModels(pool: ModelInfo[]): ModelInfo[] {
  return [...pool].sort((a, b) => {
    const rep = reputation(a.id) - reputation(b.id);
    if (rep !== 0) return rep;
    const rec = (b.created ?? 0) - (a.created ?? 0);
    if (rec !== 0) return rec;
    const ctx = (b.contextLength ?? 0) - (a.contextLength ?? 0);
    if (ctx !== 0) return ctx;
    return (a.promptPrice ?? 0) - (b.promptPrice ?? 0);
  });
}

export interface TierPicks {
  tier: Tier;
  open?: ModelInfo;
  proprietary?: ModelInfo;
  mix?: ModelInfo; // best overall, regardless of license
}

/**
 * For each tier, surface the best open-weight, best proprietary, and best
 * overall ("mix") tool-capable model.
 */
export function recommend(
  models: ModelInfo[],
  opts: { requireTools?: boolean } = {},
): TierPicks[] {
  const requireTools = opts.requireTools ?? true;
  const tiers: Tier[] = ["cheap", "mid", "premium"];

  return tiers.map((tier) => {
    const inTier = models
      .filter((m) => m.tier === tier)
      .filter((m) => (requireTools ? m.toolCapable : true));
    const ranked = rankModels(inTier);
    return {
      tier,
      open: ranked.find((m) => m.isOpen),
      proprietary: ranked.find((m) => !m.isOpen),
      mix: ranked[0],
    };
  });
}
