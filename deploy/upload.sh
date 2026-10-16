#!/usr/bin/env bash
#
# rsync the staged site to the server. Runs in CI after stage.sh and the SSH setup step.
#
# The site goes into a fresh releases/<sha> directory under /opt/websites/tracey (its own
# folder, separate from the other websites). activate.sh swaps the `current` symlink once
# the upload is complete, so a half-uploaded build is never served.
#
# Needs: DEPLOY_HOST, DEPLOY_USER, ~/.ssh/deploy_key and ~/.ssh/known_hosts.
set -euo pipefail

stage="${STAGE_DIR:-/tmp/stage}/tracey"
release="${GITHUB_SHA:-manual-$(date +%s)}"
root=/opt/websites/tracey
dest="$root/releases/$release"

if [ "${DRY_RUN:-false}" = true ]; then
  echo "==> Dry run: would upload $(find "$stage" -type f | wc -l | tr -d ' ') files to $DEPLOY_HOST:$dest"
  (cd "$stage" && find . -type f | sort | head -50)
  exit 0
fi

ssh_cmd="ssh -i $HOME/.ssh/deploy_key -o BatchMode=yes -o StrictHostKeyChecking=yes"
ssh_host="$DEPLOY_USER@$DEPLOY_HOST"

$ssh_cmd "$ssh_host" sudo install -d -m 755 /opt/websites
$ssh_cmd "$ssh_host" sudo install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" \
  "$root" "$root/releases" "$dest"

echo "==> Uploading tracey to $DEPLOY_HOST:$dest"
rsync -az --delete --human-readable --stats --link-dest="$root/current" -e "$ssh_cmd" \
  "$stage/" "$ssh_host:$dest/"
