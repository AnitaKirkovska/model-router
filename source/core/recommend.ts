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
  // S-tier frontier labs + current flagship-grade open models
  anthropic: 0,
  openai: 0,
  google: 0,
  minimax: 0, // MiniMax M3 — flagship-grade open, strongest open option for premium work
  "x-ai": 1,
  deepseek: 1,
  // A-tier — strong open + proprietary
  qwen: 2,
  "meta-llama": 2,
  mistralai: 2,
  moonshotai: 2,
  "z-ai": 2,
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
const DAY = 86400; // seconds — bucket recency by day so same-day sibling SKUs
                   // (e.g. opus-4.8 vs opus-4.8-fast) fall through to the price
                   // tiebreak, where the cheaper base model wins over a pricier
                   // latency variant.

export function rankModels(pool: ModelInfo[]): ModelInfo[] {
  return [...pool].sort((a, b) => {
    const rep = reputation(a.id) - reputation(b.id);
    if (rep !== 0) return rep;
    const rec = Math.floor((b.created ?? 0) / DAY) - Math.floor((a.created ?? 0) / DAY);
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
  /** True if `open` was filled from a lower tier (no open model priced in this tier). */
  openFromLowerTier?: boolean;
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

  const toolFiltered = models.filter((m) => (requireTools ? m.toolCapable : true));
  // Best open-weight model overall — used as a fallback when a tier has none
  // priced within it (open weights currently cap out at mid-tier pricing, so
  // premium would otherwise show "none"). Free endpoints (":free") are excluded
  // here: they're rate-limited hobby tiers, not a serious premium-grade pick.
  const bestOpenOverall = rankModels(
    toolFiltered.filter((m) => m.isOpen && !m.id.endsWith(":free")),
  )[0];

  return tiers.map((tier) => {
    const ranked = rankModels(toolFiltered.filter((m) => m.tier === tier));
    const openInTier = ranked.find((m) => m.isOpen);
    const open = openInTier ?? bestOpenOverall;
    return {
      tier,
      open,
      proprietary: ranked.find((m) => !m.isOpen),
      mix: ranked[0],
      openFromLowerTier: !openInTier && !!bestOpenOverall,
    };
  });
}
