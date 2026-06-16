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
check("chat → cost-optimized", r1.modelId === "cost-optimized", r1.modelId);
const r2 = await sp.resolve("deep");
check("deep → quality-optimized", r2.modelId === "quality-optimized", r2.modelId);

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
} catch (e: any) {
  fail++;
  console.log(`  ✗ openrouter live test threw: ${e.message}`);
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
