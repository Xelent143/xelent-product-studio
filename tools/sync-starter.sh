#!/usr/bin/env bash
# Copy the skill into the starter repository for Claude Code on the web
# (https://github.com/Xelent143/xelent-product-studio-starter), which loads skills only from .claude/skills/.
# Run after every release:  tools/sync-starter.sh [path to a checkout of the starter]
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
STARTER="${1:-$HOME/xelent-product-studio-starter}"
SKILL="$HERE/plugins/xelent-product-studio/skills/xelent-product-studio"
VERSION="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' "$HERE/plugins/xelent-product-studio/.claude-plugin/plugin.json")"
test -d "$STARTER/.git" || { echo "no starter checkout at $STARTER"; exit 1; }
rsync -a --delete --exclude evals --exclude __pycache__ --exclude .DS_Store "$SKILL/" "$STARTER/.claude/skills/xelent-product-studio/"
cd "$STARTER"
git add .claude/skills/xelent-product-studio
if git diff --cached --quiet; then echo "starter already has skill $VERSION"; exit 0; fi
git commit -q -m "Skill $VERSION from Xelent143/xelent-product-studio"
git push -q origin HEAD
echo "starter updated to skill $VERSION"
