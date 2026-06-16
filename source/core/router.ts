import type {
  HarnessAdapter,
  ModelProvider,
  RouteDecision,
} from "./types.js";
import { classify } from "./classifier.js";

/**
 * The core router. Harness-agnostic: takes a message, classifies it, asks a
 * provider to resolve a model, and (optionally) applies it via an adapter.
 */
export class Router {
  constructor(
    private provider: ModelProvider,
    private adapter?: HarnessAdapter,
  ) {}

  /** Classify + resolve a model. Does NOT apply it. */
  async decide(message: string): Promise<RouteDecision> {
    const classification = classify(message);
    const { modelId, modelName, tier } = await this.provider.resolve(
      classification.category,
    );
    return {
      ...classification,
      tier,
      modelId,
      modelName,
      provider: this.provider.name,
    };
  }

  /** Classify, resolve, and apply via the configured adapter. */
  async route(
    message: string,
  ): Promise<RouteDecision & { applied: boolean; applyDetail?: string }> {
    const decision = await this.decide(message);
    if (!this.adapter) {
      return { ...decision, applied: false, applyDetail: "no adapter configured" };
    }
    const result = await this.adapter.apply(decision);
    return { ...decision, applied: result.applied, applyDetail: result.detail };
  }
}
