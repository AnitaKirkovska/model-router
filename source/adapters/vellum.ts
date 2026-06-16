import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { HarnessAdapter, RouteDecision } from "../core/types.js";

const execFileAsync = promisify(execFile);

/**
 * Applies a routing decision to a Vellum conversation by opening a sticky
 * inference session pinned to the resolved profile.
 *
 * Note: this adapter expects `decision.modelId` to be a Vellum *profile name*
 * (cost-optimized / balanced / quality-optimized / auto / custom), i.e. use it
 * with StaticProvider + VELLUM_PROFILE_MAP. For raw OpenRouter model ids you'd
 * need a Vellum profile that points at OpenRouter as a provider.
 */
export class VellumAdapter implements HarnessAdapter {
  readonly name = "vellum";
  constructor(private opts: { ttl?: string; conversationId?: string } = {}) {}

  async apply(decision: RouteDecision): Promise<{ applied: boolean; detail?: string }> {
    const args = [
      "inference", "session", "open", decision.modelId,
      "--ttl", this.opts.ttl ?? "never",
      "--json",
    ];
    if (this.opts.conversationId) {
      args.push("--conversation-id", this.opts.conversationId);
    }
    try {
      const { stdout } = await execFileAsync("assistant", args);
      const parsed = JSON.parse(stdout.trim());
      return { applied: parsed.ok !== false, detail: stdout.trim() };
    } catch (err: any) {
      return { applied: false, detail: err?.message ?? String(err) };
    }
  }
}
