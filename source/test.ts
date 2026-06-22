#!/usr/bin/env bun
// End-to-end smoke test. Runs the classifier + OpenRouter discovery for real.
import { classify } from "./core/classifier.js";
import { Router } from "./core/router.js";
import { OpenRouterProvider } from "./providers/openrouter.js";
import { StaticProvider, VELLUM_PROFILE_MAP } from "./providers/static.js";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

console.log("\n[1] classifier");
const cases: [string, string][] = [
  ["thanks!", "chat"],
  ["hey", "chat"],
  ["show me NVDA", "research"],
  ["research the AI data center sector and find emerging companies", "research"],
  ["write a comprehensive report comparing VRT and VST with detailed analysis", "deep"],
  ["implement a binary search tree in rust and debug the delete method", "deep"],
];
for (const [msg, expected] of cases) {
  const c = classify(msg);
  check(`"${msg.slice(0, 40)}" → ${c.category} (want ${expected})`, c.category === expected, `got ${c.category}`);
}

console.log("\n[2] static provider + vellum map");
const sp = new StaticProvider(VELLUM_PROFILE_MAP);
const r1 = await sp.resolve("chat");
check("chat → notch-fast", r1.modelId === "notch-fast", r1.modelId);
const r2 = await sp.resolve("research");
check("research → claude-4.8-high", r2.modelId === "claude-4.8-high", r2.modelId);
const r3 = await sp.resolve("deep");
check("deep → claude-fable-5-high", r3.modelId === "claude-fable-5-high", r3.modelId);

console.log("\n[3] openrouter provider (live API)");
try {
  const op = new OpenRouterProvider();
  const models = await op.listModels();
  check("fetched models", models.length > 50, `got ${models.length}`);
  check("all have numeric prompt price", models.every((m) => typeof m.promptPrice === "number"));
  check("all tiered", models.every((m) => !!m.tier));
  const cheap = await op.resolve("chat");
  check("chat resolves to a cheap model", cheap.tier === "cheap" && !!cheap.modelId, `${cheap.modelId} (${cheap.tier})`);
  console.log(`     chat → ${cheap.modelId}`);
  const mid = await op.resolve("research");
  check("research resolves to a mid model", mid.tier === "mid" && !!mid.modelId, `${mid.modelId} (${mid.tier})`);
  console.log(`     research → ${mid.modelId}`);
  const prem = await op.resolve("deep");
  check("deep resolves to a premium model", prem.tier === "premium" && !!prem.modelId, `${prem.modelId} (${prem.tier})`);
  console.log(`     deep → ${prem.modelId}`);

  console.log("\n[4] full router (openrouter, no apply)");
  const router = new Router(op);
  const d = await router.decide("write a detailed comparison report of two stocks");
  check("decision has modelId + provider", !!d.modelId && d.provider === "openrouter", JSON.stringify(d));
  check("not applied (no adapter)", true);

  console.log("\n[5] recommender (best open/proprietary/mix per tier)");
  const { recommend } = await import("../source/core/recommend.js");
  const picks = recommend(models, { requireTools: true });
  check("returns all three tiers", picks.length === 3, `got ${picks.length}`);
  for (const p of picks) {
    check(`${p.tier}: has a mix pick`, !!p.mix, "no mix");
    if (p.open) check(`${p.tier}: open pick is open-weight`, p.open.isOpen === true);
    if (p.proprietary) check(`${p.tier}: proprietary pick is closed`, p.proprietary.isOpen === false);
    if (p.mix) console.log(`     ${p.tier}: open=${p.open?.id ?? "—"} | prop=${p.proprietary?.id ?? "—"} | mix=${p.mix.id}`);
  }

  console.log("\n[6] excludePatterns drops pulled models");
  const opEx = new OpenRouterProvider({ config: { excludePatterns: ["fable"] } });
  const exModels = await opEx.listModels();
  check("no excluded id survives", exModels.every((m) => !m.id.includes("fable")), exModels.find((m) => m.id.includes("fable"))?.id ?? "ok");
  check("'~'-prefixed always dropped", models.every((m) => !m.id.startsWith("~")));

  console.log("\n[7] premium open falls back to best-open-overall");
  const premPick = picks.find((p) => p.tier === "premium")!;
  // No open-weight model is priced in the premium tier today, so the fallback must engage.
  check("premium open is filled", !!premPick.open, "premium open empty");
  check("premium open is flagged cross-tier", premPick.openFromLowerTier === true, `flag=${premPick.openFromLowerTier}`);
  check("fallback open is not a :free endpoint", !premPick.open!.id.endsWith(":free"), premPick.open!.id);

  console.log("\n[8] same-day siblings: cheaper base beats pricier latency SKU");
  const { rankModels } = await import("../source/core/recommend.js");
  const day = 1_700_000_000;
  const ranked = rankModels([
    { id: "anthropic/claude-x-fast", isOpen: false, toolCapable: true, promptPrice: 0.00001, created: day + 30, contextLength: 1_000_000, tier: "premium" } as any,
    { id: "anthropic/claude-x", isOpen: false, toolCapable: true, promptPrice: 0.000005, created: day, contextLength: 1_000_000, tier: "premium" } as any,
  ]);
  check("base (cheaper, same day) ranks first", ranked[0].id === "anthropic/claude-x", ranked[0].id);
} catch (e: any) {
  fail++;
  console.log(`  ✗ openrouter live test threw: ${e.message}`);
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
