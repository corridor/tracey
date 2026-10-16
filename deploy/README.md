# Deploying tracey.genguardx.ai

The demo site is the static build of `apps/web`. It is deployed the same way as the sites in
`corridor/websites`: GitHub Actions builds it, waits for approval, rsyncs it to the websites
host over SSH, installs an nginx vhost and health-checks it. tracey has its **own folder** on
the host: `/opt/websites/tracey` (nothing is shared with the other sites).

```
/opt/websites/tracey/
  releases/<git sha>/   one directory per deployed build (newest three are kept)
  current -> releases/<git sha>   what nginx serves; swapped atomically
```

## Pipeline

`.github/workflows/deploy-web.yml`:

1. **build** (no secrets): install, typecheck, test, `deploy/stage.sh` (builds into
   `/tmp/stage/tracey`), upload the tarball as an artifact.
2. **deploy** (environment `production`, needs approval): `deploy/upload.sh` rsyncs into a new
   `releases/<sha>`, `deploy/activate.sh` installs `deploy/nginx/tracey.conf` (reverting if
   `nginx -t` fails), swaps `current`, checks that `tracey.genguardx.ai` answers through nginx,
   and rolls back to the previous release if it does not.

It runs on pushes to `master` that touch the site and can be started by hand
(**Actions > Deploy website > Run workflow**). Tick **dry_run** to build and list what would be
uploaded without touching the server.

Roll back by hand:

```bash
ln -sfn releases/<old-sha> /opt/websites/tracey/current   # nginx serves it immediately
```

## One-time setup

GitHub (repo `corridor/tracey`):

- Secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEV_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`: the same values
  `corridor/websites` uses (or share them as organisation secrets).
- Environment `production` with **Required reviewers** (this is the approval gate).
- A runner with the `light-job` label available to this repo (the same label the other repos use).

Host (the existing websites machine):

- Nothing new to install: the site is static files plus one nginx vhost. The deploy user needs
  passwordless `sudo` for `install`, `nginx` and `systemctl reload nginx`, as for the other sites.

DNS / Cloudflare:

- Add `tracey.genguardx.ai` pointing at the websites host, **Proxied**, with SSL/TLS mode
  **Flexible** (the vhost listens on port 80 only; Full or Full (Strict) would return 521 until
  nginx has a 443 block and an origin certificate), and Always Use HTTPS on.

## Try it locally

```bash
deploy/stage.sh                    # builds apps/web into /tmp/stage/tracey
deploy/upload_test.sh              # checks the upload/activate scripts against fake ssh and rsync
```
