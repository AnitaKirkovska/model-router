# model-router

Extensible, harness-agnostic LLM task router. Classifies incoming messages by task type and routes to the best model via pluggable providers and adapters.

Built with [Bun](https://bun.sh). No build step — TypeScript runs directly.

## How it works

```
message → classifier → category → provider.resolve() → modelId → adapter.apply()
```

1. **Classifier** — keyword + heuristic scoring → `chat | research | deep`
2. **Provider** — maps the category to a concrete model id
   - `StaticProvider` — fixed map (e.g. Vellum profile names)
   - `OpenRouterProvider` — live model discovery; buckets 300+ models into tiers by price
3. **Adapter** — applies the decision to a runtime
   - `VellumAdapter` — pins a sticky inference session via the `assistant` CLI

## Install

```bash
git clone https://github.com/AnitaKirkovska/model-router
cd model-router
```

Requires [Bun](https://bun.sh) >= 1.0.

## CLI

```bash
bun run source/cli.ts <command>
```

| Command | Description |
|---------|-------------|
| `setup [--provider=openrouter\|static]` | Configure provider |
| `models [cheap\|mid\|premium]` | List discovered models by tier (openrouter only) |
| `recommend [cheap\|mid\|premium] [--json]` | Best open / proprietary / mix model per tier (openrouter only) |
| `classify <message>` | Classify a message without resolving a model |
| `route <message> [--apply]` | Classify + resolve; `--apply` pins the session in Vellum |
| `config` | Print current config |

### Quick start

```bash
# Default: Vellum static profiles
bun run source/cli.ts route "show me NVDA" --apply
# → category: research | profile: claude-4.8-high | applied: true

# Switch to OpenRouter (live model discovery)
bun run source/cli.ts setup --provider=openrouter
export OPENROUTER_API_KEY=sk-or-...
bun run source/cli.ts models mid       # browse 80+ mid-tier tool-capable models
bun run source/cli.ts route "write a full sector comparison report"
# → category: deep | modelId: anthropic/claude-opus-4.8 | tier: premium
```

## Package API

```ts
import {
  Router,
  OpenRouterProvider,
  StaticProvider,
  VellumAdapter,
  VELLUM_PROFILE_MAP,
} from "./source/index.js";

// Vellum static profiles
const router = new Router(
  new StaticProvider(VELLUM_PROFILE_MAP),
  new VellumAdapter({ ttl: "never" }),
);
const result = await router.route("research AI power infrastructure companies");
// { category: "research", modelId: "claude-4.8-high", applied: true, ... }

// OpenRouter — live model discovery + explicit overrides
const orRouter = new Router(
  new OpenRouterProvider({
    apiKey: process.env.OPENROUTER_API_KEY,
    config: {
      provider: "openrouter",
      modelOverrides: {
        deep: "anthropic/claude-sonnet-4.5",
      },
    },
  }),
);
const d = await orRouter.decide("write a detailed comparison report");
// { category: "deep", modelId: "anthropic/claude-sonnet-4.5", tier: "premium", ... }
```

## Vellum integration

Install into a Vellum workspace:

```bash
bash source/vellum/install.sh [/path/to/workspace]
```

This copies:
- `source/vellum/route.ts` → `[workspace]/routes/router.ts` (HTTP route at `/v1/x/router`)
- `source/vellum/skill.md` → `[workspace]/skills/model-router/SKILL.md`
- Default config to `~/.model-router/config.json` (if not already set)

**Auth note:** Vellum's gateway authenticates all `/v1/x/*` requests at the edge. Route handlers receive pre-authenticated requests. The gateway injects auth context headers:
- `x-vellum-actor-principal-id` — the authenticated user/actor ID
- `x-vellum-principal-type` — principal type (`actor` | `service`)

The route reads these for traceability but does not re-validate them.

## Pre-model-call hook (automatic routing)

The bundled `hooks/pre-model-call.ts` runs **before every user-facing turn** and writes the chosen profile key directly to `ctx.modelProfile`. No CLI call, no session churn — the platform just sees the chosen profile for the next provider call.

It classifies the latest user message (`chat | research | deep`), then resolves the strongest **enabled** profile for that category using a two-layer match:

1. **Capability hints** — match profile labels, names, or model ids by keyword (`speed`/`fast`/`sonnet`/`haiku` for chat; `frontier`/`fable`/`opus` for deep; `quality`/`glm`/`gpt` for research).
2. **Key fallbacks** — well-known profile keys (`cost-optimized`, `balanced`, `quality-optimized`, `auto`).

The first enabled match wins. The hints are written against Vellum's profile inventory (Speed / Quality / Frontier labels, GLM and Opus model ids) but fall back gracefully on any workspace: if nothing matches, the hook no-ops and the platform default runs unchanged.

### Image-aware routing

If the latest user message includes an image block, the hook switches into vision mode before applying the normal text policy. It filters candidate profiles to `supportsVision === true` (or an equivalent `vision` / `capabilities.vision` flag), with a conservative multimodal-family fallback only when the flag is missing. Text-only models are never treated as safe by default.

That means image turns will not be sent to fast/open text-only profiles that reject image input. If no enabled vision-capable profile exists, the hook no-ops and lets the platform default handle the call.

Only `mainAgent` calls are routed. Background / utility calls are left alone so internal tooling keeps using whatever profile the platform chose.

## Extending

**Custom provider** — implement `ModelProvider`:

```ts
import type { ModelProvider, Category, Tier, CATEGORY_TIER } from "./source/index.js";

const myProvider: ModelProvider = {
  name: "my-provider",
  async resolve(category: Category) {
    return { modelId: myModelMap[category], tier: CATEGORY_TIER[category] };
  },
};
```

**Custom adapter** — implement `HarnessAdapter`:

```ts
import type { HarnessAdapter, RouteDecision } from "./source/index.js";

const myAdapter: HarnessAdapter = {
  name: "my-harness",
  async apply(decision: RouteDecision) {
    myClient.setModel(decision.modelId);
    return { applied: true };
  },
};
```

## Tier bounds (OpenRouter)

Models are bucketed by prompt price per token:

| Tier      | Prompt price cap      | Notes                                    |
|-----------|-----------------------|------------------------------------------|
| `cheap`   | ≤ $0.50/M tokens      | Fast models, free tiers included         |
| `mid`     | ≤ $3.00/M tokens      | Balanced quality/cost                    |
| `premium` | > $3.00/M tokens      | Flagship models (e.g. Opus at $5/M)      |

> **Note:** price is not a proxy for capability. Use `modelOverrides` to pin specific models per category rather than relying on auto-pick.

Customize bounds in `~/.model-router/config.json`:
```json
{ "tierBounds": { "cheap": 0.0000005, "mid": 0.000003 } }
```

### Excluding pulled / deprecated models

OpenRouter still lists some deprecated models. Two layers drop them from discovery:

- **`~`-prefixed ids** (OpenRouter's own deprecation marker) are always excluded.
- **`excludePatterns`** — a list of substrings you control. Any model id containing one is dropped.

```json
{ "excludePatterns": ["fable"] }
```

## Best-picks (`recommend`)

`recommend` surfaces, for each price tier, the standout **open-weight**, **proprietary**, and **mix** (best overall) tool-capable model:

```bash
bun run source/cli.ts recommend          # all tiers
bun run source/cli.ts recommend mid      # one tier
bun run source/cli.ts recommend --json   # machine-readable
```

Open vs proprietary is determined by the presence of a Hugging Face id in the OpenRouter metadata. Ranking is a **heuristic, not a live benchmark**: models are ordered by

1. **family reputation** — hand-curated knowledge of which orgs ship strong agentic models (Anthropic / OpenAI / Google / xAI / DeepSeek at the top)
2. **recency** — newer release wins
3. **context length**, then **price**

> Open-weight models currently cap out at mid-tier pricing — no open tool-capable model is priced in the premium tier. Rather than show "none", the premium **open** slot falls back to the best open-weight model overall (excluding `:free` rate-limited endpoints) and is tagged `(best open overall — none priced in this tier)`.

## Tests

```bash
bun test         # or:
bun run source/test.ts
```

Runs against the live OpenRouter API. Requires network access.

## File structure

```
source/
  core/
    types.ts          category, tier, provider/adapter interfaces, RouteDecision
    classifier.ts     keyword + heuristic message classifier
    recommend.ts      best open/proprietary/mix picks per tier (family-reputation ranking)
    router.ts         Router class — ties provider + adapter together
  providers/
    openrouter.ts     live OpenRouter model discovery + tier bucketing
    static.ts         fixed profile map (StaticProvider + VELLUM_PROFILE_MAP)
  adapters/
    vellum.ts         VellumAdapter — pins inference session via assistant CLI
  vellum/
    route.ts          drop-in Vellum route handler (/v1/x/router)
    skill.md          drop-in Vellum skill (model-router)
    install.sh        copies vellum/ files to the right workspace paths
  index.ts            public exports
  cli.ts              model-router CLI
  test.ts             end-to-end smoke tests
assets/               placeholder (future: built binaries)
package.json
README.md
```

## License

MIT
