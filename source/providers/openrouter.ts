import type {
  Category,
  ModelInfo,
  ModelProvider,
  RouterConfig,
  Tier,
} from "../core/types.js";
import { CATEGORY_TIER } from "../core/types.js";

const MODELS_URL = "https://openrouter.ai/api/v1/models";

/** Raw shape from OpenRouter /api/v1/models (only fields we use). */
interface ORModel {
  id: string;
  name: string;
  context_length: number | null;
  pricing: { prompt: string; completion: string };
  supported_parameters?: string[];
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
}

/**
 * Routes to any model available on OpenRouter. Discovers the live model list,
 * buckets models into cheap/mid/premium tiers by prompt price, and picks one
 * per task category.
 */
export class OpenRouterProvider implements ModelProvider {
  readonly name = "openrouter";
  private cache: ModelInfo[] | null = null;
  private apiKey?: string;
  private cfg: RouterConfig;

  constructor(opts: { apiKey?: string; config?: Partial<RouterConfig> } = {}) {
    this.apiKey = opts.apiKey;
    this.cfg = {
      provider: "openrouter",
      tierBounds: { cheap: 0.0000005, mid: 0.000005 }, // USD/token boundaries
      requireTools: true,
      ...opts.config,
    };
  }

  /** Fetch + normalize the live model list (cached after first call). */
  async listModels(force = false): Promise<ModelInfo[]> {
    if (this.cache && !force) return this.cache;

    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;

    const res = await fetch(MODELS_URL, { headers });
    if (!res.ok) {
      throw new Error(`OpenRouter models fetch failed: ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as { data: ORModel[] };

    const models: ModelInfo[] = json.data
      .map((m) => {
        const promptPrice = parseFloat(m.pricing?.prompt ?? "NaN");
        const completionPrice = parseFloat(m.pricing?.completion ?? "NaN");
        const toolCapable = (m.supported_parameters ?? []).includes("tools");
        return {
          id: m.id,
          name: m.name,
          promptPrice: Number.isFinite(promptPrice) ? promptPrice : undefined,
          completionPrice: Number.isFinite(completionPrice) ? completionPrice : undefined,
          contextLength: m.context_length ?? undefined,
          toolCapable,
          tier: undefined as Tier | undefined,
        } satisfies ModelInfo;
      })
      // Drop models with unknown or sentinel (-1) pricing — they can't be tiered.
      .filter((m) => m.promptPrice !== undefined && m.promptPrice >= 0)
      .map((m) => ({ ...m, tier: this.priceTier(m.promptPrice!) }));

    this.cache = models;
    return models;
  }

  private priceTier(promptPrice: number): Tier {
    const { cheap, mid } = this.cfg.tierBounds!;
    if (promptPrice <= cheap) return "cheap";
    if (promptPrice <= mid) return "mid";
    return "premium";
  }

  /** Candidate models for a tier, sorted cheapest-first, optionally tool-capable. */
  private async candidates(tier: Tier): Promise<ModelInfo[]> {
    const all = await this.listModels();
    return all
      .filter((m) => m.tier === tier)
      .filter((m) => (this.cfg.requireTools ? m.toolCapable : true))
      .sort((a, b) => (a.promptPrice ?? 0) - (b.promptPrice ?? 0));
  }

  async resolve(
    category: Category,
  ): Promise<{ modelId: string; modelName?: string; tier: Tier }> {
    const tier = CATEGORY_TIER[category];

    // Explicit override wins.
    const override = this.cfg.modelOverrides?.[category];
    if (override) {
      const all = await this.listModels();
      const hit = all.find((m) => m.id === override);
      return { modelId: override, modelName: hit?.name, tier };
    }

    // Auto-pick = cheapest model in the tier. Price is NOT a capability proxy
    // (legacy models can be pricey and weak), so for "deep" work you should set
    // an explicit modelOverrides entry. This default just keeps you in-tier.
    const pool = await this.candidates(tier);
    if (pool.length === 0) {
      throw new Error(`No OpenRouter models available for tier "${tier}"`);
    }
    const pick = pool[0];
    return { modelId: pick.id, modelName: pick.name, tier };
  }
}
