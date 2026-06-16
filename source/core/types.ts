// ─── Core types — harness-agnostic ───────────────────────────────────────────

/** Task categories the router classifies messages into. */
export type Category = "chat" | "research" | "deep";

/** A cost/capability tier. Providers map categories onto these. */
export type Tier = "cheap" | "mid" | "premium";

/** Default mapping from task category to capability tier. */
export const CATEGORY_TIER: Record<Category, Tier> = {
  chat: "cheap",
  research: "mid",
  deep: "premium",
};

/** A model a provider can route to. */
export interface ModelInfo {
  /** Provider-native model identifier (e.g. "anthropic/claude-3.5-sonnet" or "balanced"). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Prompt price in USD per token, if known. */
  promptPrice?: number;
  /** Completion price in USD per token, if known. */
  completionPrice?: number;
  /** Context window size in tokens, if known. */
  contextLength?: number;
  /** Whether the model supports tool/function calling. */
  toolCapable?: boolean;
  /** True if open-weight (has a Hugging Face id); false if proprietary. */
  isOpen?: boolean;
  /** Unix timestamp the model was published, if known (recency signal). */
  created?: number;
  /** Tier this model was bucketed into, if computed. */
  tier?: Tier;
}

/** The outcome of classifying a message. */
export interface Classification {
  category: Category;
  scores: Record<Category, number>;
  wordCount: number;
  /** Confidence 0..1, derived from score margin. */
  confidence: number;
}

/** A full routing decision: classification + the model chosen for it. */
export interface RouteDecision extends Classification {
  tier: Tier;
  /** The resolved model/profile id to use. */
  modelId: string;
  /** The provider that resolved it. */
  provider: string;
  /** Human-readable model name, if available. */
  modelName?: string;
}

/**
 * A model source. Implementations resolve a category/tier to a concrete model.
 * Examples: OpenRouterProvider (live API), StaticProvider (fixed map, e.g. Vellum profiles).
 */
export interface ModelProvider {
  readonly name: string;
  /** Resolve a category to a concrete model id for this provider. */
  resolve(category: Category): Promise<{ modelId: string; modelName?: string; tier: Tier }>;
  /** Optional: enumerate candidate models (for setup / discovery UIs). */
  listModels?(): Promise<ModelInfo[]>;
}

/**
 * A harness adapter applies a decision to a specific runtime
 * (Vellum inference session, an env var, an API client, etc.).
 */
export interface HarnessAdapter {
  readonly name: string;
  apply(decision: RouteDecision): Promise<{ applied: boolean; detail?: string }>;
}

/** Persisted configuration for the router. */
export interface RouterConfig {
  /** Which provider to use: "openrouter" | "static" | custom. */
  provider: string;
  /** For static provider: category -> model/profile id. */
  staticMap?: Record<Category, string>;
  /** For openrouter: explicit category -> model id overrides (skip tier auto-pick). */
  modelOverrides?: Partial<Record<Category, string>>;
  /** For openrouter: tier -> max prompt price (USD/token) boundaries. */
  tierBounds?: { cheap: number; mid: number };
  /** Require tool-calling support when auto-picking (default true). */
  requireTools?: boolean;
}
