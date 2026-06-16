---
name: Model Router
emoji: 🔀
description: >
  Automatically routes each conversation to the best LLM profile based on task
  type. Activates at the start of every turn and when the task type shifts.
metadata:
  vellum:
    activation-hints:
      - "*"
    always-active: true
---

## Purpose

Route each conversation to the right model before responding.

| Category   | Profile (static/Vellum) | Use when                                          |
|------------|-------------------------|---------------------------------------------------|
| `chat`     | cost-optimized          | Quick questions, admin, casual, simple Y/N        |
| `research` | balanced                | Stock lookups, research, web search, analysis     |
| `deep`     | quality-optimized       | Full reports, complex code, in-depth comparisons  |

With the openrouter provider, any of 300+ live models can be used instead.

## Steps

### 1. Route the message

```bash
cd /workspace/external/model-router-plugin && bun run source/cli.ts route "<message>" --apply
```

### 2. Read the result

```json
{
  "category": "research",
  "profile": "balanced",
  "applied": true
}
```

### 3. Act on it

- Session pinned → takes effect next turn.
- Only announce a tier change if going up significantly (chat → deep).
- On failure: `assistant inference session open balanced --ttl never`

## SKILL COMPLETE WHEN
- Message classified and profile resolved
- Session pinned via `--apply`
- Tier change noted if significant
