#!/usr/bin/env bash
#
# Exercises upload.sh against fake ssh/rsync so the commands can be checked without a server.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$tmp/bin" "$tmp/stage/tracey"
touch "$tmp/stage/tracey/index.html"
for tool in ssh rsync; do
  printf '#!/usr/bin/env bash\nprintf "%s"; printf " %%q" "$@"; printf "\\n"\n' "$tool" > "$tmp/bin/$tool"
  chmod +x "$tmp/bin/$tool"
done

run() {
  PATH="$tmp/bin:$PATH" HOME="$tmp/home" STAGE_DIR="$tmp/stage" DEPLOY_HOST=host.example \
    DEPLOY_USER=deploy GITHUB_SHA=abc123 "$@" "$root/deploy/upload.sh"
}

out="$(run env DRY_RUN=false)"
echo "$out" | grep -q 'rsync' || { echo "FAIL: no rsync call" >&2; exit 1; }
echo "$out" | grep -q '/opt/websites/tracey/releases/abc123/' || { echo "FAIL: wrong destination" >&2; exit 1; }
echo "$out" | grep -q -- '--link-dest=/opt/websites/tracey/current' || { echo "FAIL: no link-dest" >&2; exit 1; }
if echo "$out" | grep -q '/opt/websites/ggx'; then echo "FAIL: touches another site's folder" >&2; exit 1; fi

dry="$(run env DRY_RUN=true)"
if echo "$dry" | grep -q 'rsync'; then echo "FAIL: dry run called rsync" >&2; exit 1; fi

echo "upload.sh checks passed"
