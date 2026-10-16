#!/usr/bin/env bash
#
# Make an uploaded release live and check that it answers. Runs in CI after upload.sh.
#
# Installs the nginx vhost (reverting it if `nginx -t` fails), swaps the `current` symlink,
# health-checks tracey.genguardx.ai through nginx, and on failure swaps back to the previous
# release. To roll back by hand:
#   ln -sfn releases/<old-sha> /opt/websites/tracey/current
#
# Needs: DEPLOY_HOST, DEPLOY_USER, ~/.ssh/deploy_key and ~/.ssh/known_hosts.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
release="${GITHUB_SHA:-}"
ssh_opts=(-i "$HOME/.ssh/deploy_key" -o BatchMode=yes -o StrictHostKeyChecking=yes)

# Install the nginx vhost. If the new config fails `nginx -t`, restore the old one (or remove
# the new one) so the other sites on the host keep serving.
ssh "${ssh_opts[@]}" "$DEPLOY_USER@$DEPLOY_HOST" bash -s -- "$(base64 -w0 < "$root/deploy/nginx/tracey.conf")" <<'NGINX'
set -euo pipefail
conf="/etc/nginx/conf.d/tracey.conf"
new="$(mktemp)" old="$(mktemp)"
trap 'rm -f "$new" "$old"' EXIT
printf '%s' "$1" | base64 -d > "$new"
had=false
if [ -f "$conf" ]; then sudo cp "$conf" "$old"; had=true; fi
sudo install -m 644 "$new" "$conf"
if sudo nginx -t; then
  sudo systemctl reload nginx
else
  if $had; then sudo install -m 644 "$old" "$conf"; else sudo rm -f "$conf"; fi
  echo "!! nginx -t failed for $conf; reverted" >&2
  exit 1
fi
NGINX

ssh "${ssh_opts[@]}" "$DEPLOY_USER@$DEPLOY_HOST" bash -s -- "$release" <<'EOF'
set -euo pipefail
release="$1"
root=/opt/websites/tracey
dir="$root/releases/$release"

healthy() {
  for _ in $(seq 1 10); do
    if curl -fsS -H 'Host: tracey.genguardx.ai' http://127.0.0.1/ | grep -q '<title>tracey'; then return 0; fi
    sleep 2
  done
  return 1
}

[ -f "$dir/index.html" ] || { echo "!! $dir/index.html missing; upload incomplete" >&2; exit 1; }

cd "$root"
previous="$(readlink current || true)"
ln -sfn "releases/$release" current.new
mv -T current.new current

if healthy; then
  echo "==> tracey is up on release $release"
  # Keep the three newest releases for rollback.
  ls -1dt releases/* | tail -n +4 | xargs -r rm -rf
  exit 0
fi

echo "!! tracey did not become healthy" >&2
if [ -n "$previous" ]; then
  echo "==> Rolling back to $previous" >&2
  ln -sfn "$previous" current.new
  mv -T current.new current
else
  echo "!! No previous release to roll back to; $release is still current" >&2
fi
exit 1
EOF
