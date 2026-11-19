#!/bin/sh
# Rebuild and redeploy the netcup cron worker (minion-hub-cron.service) from the
# CURRENT checkout. The worker does not follow Vercel deploys: when it lags the
# database schema its ticks fail (2026-10-05: Meta sync dead for six weeks).
# Run after any merge that touches a tick route, a sync service or a migration.
#   usage: scripts/ops/deploy-cron-worker.sh [user@host]
set -eu
host=${1:-niko@152.53.91.108}
dest=/opt/minion-hub-cron
[ -z "$(git status --porcelain)" ] || { echo "refusing: working tree is dirty" >&2; exit 1; }
sha=$(git rev-parse HEAD)
bun install --frozen-lockfile
bun run i18n:compile
DESKTOP=1 bun run vite build   # DESKTOP=1 selects adapter-node; the box has no bun, so build here
printf '%s\n' "$sha" > build/DEPLOYED_SHA
rsync -az --delete ./build ./package.json ./node_modules "$host:$dest/"
ssh "$host" "sudo -n systemctl restart minion-hub-cron && sleep 5 && systemctl is-active minion-hub-cron && cat $dest/build/DEPLOYED_SHA"
