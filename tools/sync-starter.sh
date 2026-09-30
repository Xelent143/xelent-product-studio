#!/usr/bin/env bash
# Copy the skills into the starter repository for Claude Code on the web
# (https://github.com/Xelent143/xelent-product-studio-starter), which loads skills only from .claude/skills/.
# Run after every release:  tools/sync-starter.sh [path to a checkout of the starter]
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
STARTER="${1:-$HOME/xelent-product-studio-starter}"
SKILLS="$HERE/plugins/xelent-product-studio/skills"
VERSION="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' "$HERE/plugins/xelent-product-studio/.claude-plugin/plugin.json")"
test -d "$STARTER/.git" || { echo "no starter checkout at $STARTER"; exit 1; }
# The two skills share one API client; a difference means one copy was edited without the other.
cmp -s "$SKILLS/xelent-product-studio/scripts/xelent.mjs" "$SKILLS/xelent-product-video/scripts/xelent.mjs" ||
  { echo "scripts/xelent.mjs differs between the two skills; make them identical first"; exit 1; }
for skill in xelent-product-studio xelent-product-video; do
  rsync -a --delete --exclude evals --exclude __pycache__ --exclude .DS_Store "$SKILLS/$skill/" "$STARTER/.claude/skills/$skill/"
done
cd "$STARTER"
git add .claude/skills
if git diff --cached --quiet; then echo "starter already has skill $VERSION"; exit 0; fi
git commit -q -m "Skill $VERSION from Xelent143/xelent-product-studio"
git push -q origin HEAD
echo "starter updated to skill $VERSION"
