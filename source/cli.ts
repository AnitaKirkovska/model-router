#!/usr/bin/env bun
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { Router } from "./core/router.js";
import { classify } from "./core/classifier.js";
import { OpenRouterProvider } from "./providers/openrouter.js";
import { StaticProvider, VELLUM_PROFILE_MAP } from "./providers/static.js";
import { VellumAdapter } from "./adapters/vellum.js";
import type { Category, ModelProvider, RouterConfig, Tier } from "./core/types.js";

const CONFIG_PATH =
  process.env.MODEL_ROUTER_CONFIG ?? join(homedir(), ".model-router", "config.json");

function loadConfig(): RouterConfig {
  if (!existsSync(CONFIG_PATH)) {
    return { provider: "static", staticMap: VELLUM_PROFILE_MAP };
  }
  return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
}

function saveConfig(cfg: RouterConfig): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function getApiKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY || undefined;
}

function buildProvider(cfg: RouterConfig): ModelProvider {
  if (cfg.provider === "openrouter") {
    return new OpenRouterProvider({ apiKey: getApiKey(), config: cfg });
  }
  return new StaticProvider(cfg.staticMap ?? VELLUM_PROFILE_MAP);
}

const C = { reset: "\x1b[0m", dim: "\x1b[2m", b: "\x1b[1m", g: "\x1b[32m", c: "\x1b[36m", y: "\x1b[33m" };
function fmtPrice(p?: number): string {
  if (p === undefined) return "?";
  return `$${(p * 1_000_000).toFixed(2)}/M`;
}

async function cmdModels(args: string[]) {
  const cfg = loadConfig();
  if (cfg.provider !== "openrouter") {
    console.log("models discovery only applies to the openrouter provider.");
    console.log(`current provider: ${cfg.provider}`);
    return;
  }
  const prov = new OpenRouterProvider({ apiKey: getApiKey(), config: cfg });
  const all = await prov.listModels();
  const tierFilter = args[0] as Tier | undefined;
  const tiers: Tier[] = tierFilter ? [tierFilter] : ["cheap", "mid", "premium"];
  for (const tier of tiers) {
    const inTier = all.filter((m) => m.tier === tier && (cfg.requireTools ? m.toolCapable : true))
      .sort((a, b) => (a.promptPrice ?? 0) - (b.promptPrice ?? 0));
    console.log(`\n${C.b}${tier.toUpperCase()}${C.reset} ${C.dim}(${inTier.length} tool-capable models)${C.reset}`);
    for (const m of inTier.slice(0, 10)) {
      console.log(`  ${C.c}${m.id}${C.reset}  ${C.dim}${fmtPrice(m.promptPrice)} in · ${fmtPrice(m.completionPrice)} out · ${((m.contextLength ?? 0) / 1000).toFixed(0)}k ctx${C.reset}`);
    }
    if (inTier.length > 10) console.log(`  ${C.dim}… and ${inTier.length - 10} more${C.reset}`);
  }
  console.log(`\n${C.dim}total tiered models: ${all.length}${C.reset}`);
}

async function cmdClassify(args: string[]) {
  const msg = args.join(" ");
  if (!msg) return console.log("usage: model-router classify <message>");
  const c = classify(msg);
  console.log(JSON.stringify(c, null, 2));
}

async function cmdRoute(args: string[]) {
  const apply = args.includes("--apply");
  const msg = args.filter((a) => a !== "--apply").join(" ");
  if (!msg) return console.log("usage: model-router route <message> [--apply]");
  const cfg = loadConfig();
  const provider = buildProvider(cfg);
  const adapter = apply ? new VellumAdapter() : undefined;
  const router = new Router(provider, adapter);
  const result = apply ? await router.route(msg) : await router.decide(msg);
  console.log(JSON.stringify(result, null, 2));
}

async function cmdSetup(args: string[]) {
  // Non-interactive setup via flags; falls back to a guided summary.
  const cfg = loadConfig();
  const provFlag = args.find((a) => a.startsWith("--provider="))?.split("=")[1];

  if (provFlag === "openrouter") {
    cfg.provider = "openrouter";
    cfg.tierBounds = cfg.tierBounds ?? { cheap: 0.0000005, mid: 0.000005 };
    cfg.requireTools = cfg.requireTools ?? true;
    saveConfig(cfg);
    const key = getApiKey();
    console.log(`${C.g}✓${C.reset} provider set to openrouter`);
    console.log(key ? `${C.g}✓${C.reset} using OPENROUTER_API_KEY from env` : `${C.y}!${C.reset} no OPENROUTER_API_KEY set — model list is public, but routing requests need a key`);
    console.log(`\nrun ${C.c}model-router models${C.reset} to see what's available per tier`);
    return;
  }
  if (provFlag === "static") {
    cfg.provider = "static";
    cfg.staticMap = cfg.staticMap ?? VELLUM_PROFILE_MAP;
    saveConfig(cfg);
    console.log(`${C.g}✓${C.reset} provider set to static`);
    console.log(JSON.stringify(cfg.staticMap, null, 2));
    return;
  }

  // No flag: show current state + options.
  console.log(`${C.b}model-router setup${C.reset}\n`);
  console.log(`config: ${C.dim}${CONFIG_PATH}${C.reset}`);
  console.log(`current provider: ${C.c}${cfg.provider}${C.reset}\n`);
  console.log("choose a provider:");
  console.log(`  ${C.c}--provider=openrouter${C.reset}  route to any model on OpenRouter (337+ models, live discovery)`);
  console.log(`  ${C.c}--provider=static${C.reset}      route to fixed harness profiles (e.g. Vellum's cost/balanced/quality)`);
  console.log(`\nfor openrouter, set ${C.c}OPENROUTER_API_KEY${C.reset} in your env to enable actual inference calls.`);
}

async function cmdConfig() {
  console.log(`config: ${CONFIG_PATH}`);
  console.log(JSON.stringify(loadConfig(), null, 2));
}

function help() {
  console.log(`${C.b}model-router${C.reset} — extensible LLM task router

usage:
  model-router setup [--provider=openrouter|static]   configure provider
  model-router models [cheap|mid|premium]              list discovered models by tier (openrouter)
  model-router classify <message>                      classify a message only
  model-router route <message> [--apply]               classify + resolve a model (--apply pins it in Vellum)
  model-router config                                  print current config

env:
  OPENROUTER_API_KEY    OpenRouter key (model list is public; inference needs a key)
  MODEL_ROUTER_CONFIG   override config path (default ~/.model-router/config.json)
`);
}

const [cmd, ...rest] = process.argv.slice(2);
const run = async () => {
  switch (cmd) {
    case "setup": return cmdSetup(rest);
    case "models": return cmdModels(rest);
    case "classify": return cmdClassify(rest);
    case "route": return cmdRoute(rest);
    case "config": return cmdConfig();
    case "help": case "--help": case "-h": case undefined: return help();
    default: console.log(`unknown command: ${cmd}\n`); help();
  }
};
run().catch((e) => { console.error(`${C.y}error:${C.reset}`, e.message); process.exit(1); });
