#!/usr/bin/env bash
# install.sh — wire model-router into a Vellum workspace
# Usage: bash source/vellum/install.sh [WORKSPACE_DIR]
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
WORKSPACE="${1:-/workspace}"

echo "model-router: installing into $WORKSPACE"

# 1. Route handler
ROUTES_DIR="$WORKSPACE/routes"
mkdir -p "$ROUTES_DIR"
cp "$PLUGIN_DIR/source/vellum/route.ts" "$ROUTES_DIR/router.ts"
echo "  ✓ route: $ROUTES_DIR/router.ts"

# 2. Skill
SKILL_DIR="$WORKSPACE/skills/model-router"
mkdir -p "$SKILL_DIR"
cp "$PLUGIN_DIR/source/vellum/skill.md" "$SKILL_DIR/SKILL.md"
echo "  ✓ skill: $SKILL_DIR/SKILL.md"

# 3. Config default (only if not already set)
CONFIG_PATH="${MODEL_ROUTER_CONFIG:-$HOME/.model-router/config.json}"
if [ ! -f "$CONFIG_PATH" ]; then
  mkdir -p "$(dirname "$CONFIG_PATH")"
  cat > "$CONFIG_PATH" <<'JSON'
{
  "provider": "static",
  "staticMap": {
    "chat": "cost-optimized",
    "research": "balanced",
    "deep": "quality-optimized"
  }
}
JSON
  echo "  ✓ config: $CONFIG_PATH"
else
  echo "  - config: $CONFIG_PATH (already exists, skipped)"
fi

echo ""
echo "done. to switch to openrouter:"
echo "  bun run $PLUGIN_DIR/source/cli.ts setup --provider=openrouter"
echo "  export OPENROUTER_API_KEY=sk-or-..."
