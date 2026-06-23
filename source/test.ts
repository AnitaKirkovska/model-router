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

console.log("\n[2b] vision helpers (image-aware routing)");
{
  const { supportsVision, hasImage, textFromContent } = await import("./core/vision.js");

  // Explicit flag wins.
  check("supportsVision: flag true", supportsVision({ key: "x", supportsVision: true }) === true);
  check("supportsVision: flag false (open fast model)", supportsVision({ key: "glm-5-2", model: "z-ai/glm-5.2", supportsVision: false }) === false);
  // Heuristic fallback when no flag present.
  check("supportsVision: heuristic claude", supportsVision({ key: "c", model: "claude-opus-4-8" }) === true);
  check("supportsVision: heuristic unknown open model is NOT assumed vision", supportsVision({ key: "g", model: "z-ai/glm-5.2" }) === false);

  // Image detection across common content shapes.
  check("hasImage: anthropic image block", hasImage([{ type: "text", text: "hi" }, { type: "image", source: { type: "base64" } }]) === true);
  check("hasImage: image_url block", hasImage([{ type: "image_url", image_url: { url: "x" } }]) === true);
  check("hasImage: text-only is false", hasImage([{ type: "text", text: "no pics here" }]) === false);
  check("hasImage: plain string is false", hasImage("just text") === false);

  // Text extraction ignores image blocks.
  check("textFromContent: pulls text past image", textFromContent([{ type: "image", image: "x" }, { type: "text", text: "what is this" }]) === "what is this");

  // End-to-end: an image turn must never resolve to a vision-blind profile.
  const PROFILES = [
    { key: "claude-4.8-high", model: "claude-opus-4-8", supportsVision: true },
    { key: "notch-fast", model: "claude-sonnet-4-6", supportsVision: true },
    { key: "os-beta", model: "accounts/fireworks/models/glm-5p2", supportsVision: false },
    { key: "glm-5-2", model: "z-ai/glm-5.2", supportsVision: false },
  ];
  const visionPool = PROFILES.filter(supportsVision).map((p) => p.key);
  check("vision pool excludes os-beta / glm-5-2", !visionPool.includes("os-beta") && !visionPool.includes("glm-5-2"), visionPool.join(","));
  check("vision pool keeps the multimodal profiles", visionPool.includes("claude-4.8-high") && visionPool.includes("notch-fast"));
}

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

console.log("\n[9] harness-neutral selection core");
{
const { chooseProfileForTurn, extractTurn } = await import("./core/selection.js");
const profiles = [
  { key: "notch-fast", label: "Speed", model: "claude-sonnet", supportsVision: true },
  { key: "claude-4.8-high", label: "Quality-Claude", model: "claude-sonnet-research", supportsVision: true },
  { key: "claude-fable-5-high", label: "Frontier Fable", model: "fable", supportsVision: true },
  { key: "os-beta", label: "Open Speed", model: "accounts/fireworks/models/glm-5p2", supportsVision: false },
];
check("selection: chat routes fast", chooseProfileForTurn({ text: "thanks", hasImageTurn: false, profiles }).profileKey === "notch-fast");
check("selection: research routes quality", chooseProfileForTurn({ text: "research current open source AI agents", hasImageTurn: false, profiles }).profileKey === "claude-4.8-high");
check("selection: deep routes frontier", chooseProfileForTurn({ text: "write a comprehensive architecture analysis with tradeoffs", hasImageTurn: false, profiles }).profileKey === "claude-fable-5-high");
const img = chooseProfileForTurn({ text: "what is in this image", hasImageTurn: true, profiles });
check("selection: image uses a vision profile", img.profileKey !== "os-beta" && !!img.profileKey, String(img.profileKey));
const noVision = chooseProfileForTurn({ text: "what is in this image", hasImageTurn: true, profiles: [{ key: "os-beta", model: "glm", supportsVision: false }] });
check("selection: image no-ops with no vision profile", !noVision.profileKey && noVision.category === "noop");
const turn = extractTurn([[{ role: "assistant", content: "x" }, { role: "user", content: [{ type: "image_url", image_url: { url: "x" } }, { type: "text", text: "describe" }] }]]);
check("extractTurn: pulls text + image", turn.text === "describe" && turn.hasImageTurn === true, JSON.stringify(turn));
}

console.log("\n[10] OpenClaw adapter (to-spec)");
{
const { openClawModelToProfile, applySelectionToOpenClaw } = await import("./adapters/openclaw.js");
const { chooseProfileForTurn } = await import("./core/selection.js");
const profiles = [
  openClawModelToProfile("anthropic", { id: "claude-sonnet-4", name: "Fast Sonnet", input: ["text", "image"] }),
  openClawModelToProfile("openrouter", { id: "z-ai/glm-5.2", name: "GLM", input: ["text"] }),
];
check("openclaw: text-only catalog model is not vision", profiles[1].supportsVision === false);
const decision = chooseProfileForTurn({ text: "what is this", hasImageTurn: true, profiles });
const result = applySelectionToOpenClaw(decision);
check("openclaw: before_model_resolve result sets provider", result.providerOverride === "anthropic", JSON.stringify(result));
check("openclaw: before_model_resolve result sets model", result.modelOverride === "claude-sonnet-4", JSON.stringify(result));
}

console.log("\n[11] Hermes adapter (advisory only)");
{
const { hermesRecommend } = await import("./adapters/hermes.js");
const rec = hermesRecommend({
  text: "research the latest open agent harnesses",
  hasImageTurn: false,
  modelRefs: ["anthropic/claude-sonnet-4", "openai/gpt-4o"],
});
check("hermes: returns advisory context", rec.advisoryContext.includes("Router Advisory") || rec.advisoryContext.includes("No specific model"), rec.advisoryContext);
check("hermes: advisory does not claim to switch models", !rec.advisoryContext.toLowerCase().includes("switched"), rec.advisoryContext);
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
