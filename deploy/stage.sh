#!/usr/bin/env bash
#
# Build the tracey website and lay out exactly what gets uploaded to the server.
#
# Usage: deploy/stage.sh            (from anywhere, after `pnpm install`)
# Output: $STAGE_DIR/tracey (default /tmp/stage/tracey)
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
stage="${STAGE_DIR:-/tmp/stage}/tracey"

cd "$root"
rm -rf "$stage"
mkdir -p "$stage"

echo "==> Building tracey web"
pnpm --filter @ggx/tracey-web build

echo "==> Staging into $stage"
cp -a apps/web/dist/. "$stage/"

test -f "$stage/index.html" || { echo "!! build produced no index.html" >&2; exit 1; }
echo "==> Staged:"
du -sh "$stage"
