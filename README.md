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
# → category: research | profile: balanced | applied: true

# Switch to OpenRouter (live model discovery)
bun run source/cli.ts setup --provider=openrouter
export OPENROUTER_API_KEY=sk-or-...
bun run source/cli.ts models mid       # browse 80+ mid-tier tool-capable models
bun run source/cli.ts route "write a full sector comparison report"
# → category: deep | modelId: ~anthropic/claude-fable-latest | tier: premium
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
// { category: "research", modelId: "balanced", applied: true, ... }

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
| `mid`     | ≤ $5.00/M tokens      | Balanced quality/cost                    |
| `premium` | > $5.00/M tokens      | Flagship models                          |

> **Note:** price is not a proxy for capability. Use `modelOverrides` to pin specific models per category rather than relying on auto-pick.

Customize bounds in `~/.model-router/config.json`:
```json
{ "tierBounds": { "cheap": 0.0000005, "mid": 0.000005 } }
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

> Open-weight models currently cap out at mid-tier pricing — there are no open tool-capable models above ~$5/M tokens, so the premium tier's "open" slot is typically empty. That's accurate, not a gap.

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
