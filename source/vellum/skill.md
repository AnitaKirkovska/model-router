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

| Category   | Profile key            | Model              | Use when                                         |
|------------|------------------------|--------------------|--------------------------------------------------|
| `chat`     | notch-fast             | Sonnet (fast)      | Quick questions, admin, casual, simple Y/N       |
| `research` | claude-4.8-high        | Quality-Claude     | Lookups, research, web search, analysis          |
| `deep`     | claude-fable-5-high    | Frontier (Fable)   | Full reports, complex code, in-depth comparisons |

Profile keys are resolved in order of preference. If a profile is disabled the next fallback fires automatically. Routing happens entirely from the classifier — never from personal profile names or private workspace config.

**Images:** if the message includes an image, routing switches to vision mode and only vision-capable profiles are considered, so an image is never sent to a text-only model.

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
