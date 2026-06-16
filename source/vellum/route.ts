/**
 * Vellum route handler — drop into /workspace/routes/router.ts
 *
 * Auth: Vellum's gateway authenticates all /v1/x/* requests at the edge
 * before they reach this handler. By the time this code runs, the request
 * is trusted. The gateway injects auth context as headers:
 *   x-vellum-actor-principal-id  — the authenticated user/actor ID
 *   x-vellum-principal-type      — principal type ("actor" | "service")
 *
 * The handler reads these for logging/traceability but does NOT need to
 * re-validate them — that's the gateway's job.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Router } from "../core/router.js";
import { classify } from "../core/classifier.js";
import { OpenRouterProvider } from "../providers/openrouter.js";
import { StaticProvider, VELLUM_PROFILE_MAP } from "../providers/static.js";
import { VellumAdapter } from "../adapters/vellum.js";
import type { ModelProvider, RouterConfig } from "../core/types.js";

export const description =
  "model-router — classifies a message and routes to the best model via pluggable providers";

const CONFIG_PATH =
  process.env.MODEL_ROUTER_CONFIG ?? join(homedir(), ".model-router", "config.json");

function loadConfig(): RouterConfig {
  if (!existsSync(CONFIG_PATH)) return { provider: "static", staticMap: VELLUM_PROFILE_MAP };
  try { return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")); }
  catch { return { provider: "static", staticMap: VELLUM_PROFILE_MAP }; }
}

function buildProvider(cfg: RouterConfig): ModelProvider {
  if (cfg.provider === "openrouter") {
    return new OpenRouterProvider({ apiKey: process.env.OPENROUTER_API_KEY, config: cfg });
  }
  return new StaticProvider(cfg.staticMap ?? VELLUM_PROFILE_MAP);
}

/** Extract Vellum auth context from gateway-injected headers. */
function authContext(req: Request) {
  return {
    principalId: req.headers.get("x-vellum-actor-principal-id") ?? "unknown",
    principalType: req.headers.get("x-vellum-principal-type") ?? "unknown",
  };
}

// GET /v1/x/router?q=<message>  — classify only, no side effects
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const q = url.searchParams.get("q");
  const cfg = loadConfig();
  const ctx = authContext(req);
  if (q) return Response.json({ classification: classify(q), config: cfg, auth: ctx });
  return Response.json({ description: "POST { message, apply? } to classify and route", config: cfg });
}

// POST /v1/x/router  { message: string, apply?: boolean }
export async function POST(req: Request): Promise<Response> {
  let body: any;
  try { body = await req.json(); }
  catch { return Response.json({ error: "invalid JSON body" }, { status: 400 }); }

  const message = (body.message as string)?.trim();
  if (!message) return Response.json({ error: "message is required" }, { status: 400 });

  const apply = body.apply !== false;
  const cfg = loadConfig();
  const ctx = authContext(req);

  try {
    const provider = buildProvider(cfg);
    const useAdapter = apply && cfg.provider === "static";
    const adapter = useAdapter ? new VellumAdapter({ ttl: "never" }) : undefined;
    const router = new Router(provider, adapter);
    const result = useAdapter
      ? await router.route(message)
      : {
          ...(await router.decide(message)),
          applied: false,
          applyDetail: apply && cfg.provider === "openrouter"
            ? "openrouter model ids are not Vellum profiles — classify only"
            : "apply disabled",
        };
    return Response.json({ ...result, auth: ctx });
  } catch (err: any) {
    return Response.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}
