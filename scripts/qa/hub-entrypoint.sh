#!/usr/bin/env bash
# Entrypoint for the hub-qa app container (docker-compose.qa.yml).
# Runs inside oven/bun:1 (Debian, has /usr/bin/bash) with the worktree
# bind-mounted at /app.
set -euo pipefail

cd /app

if [ ! -d node_modules ]; then
  echo "[hub-qa] node_modules missing — running bun install --frozen-lockfile"
  # ponytail: root-owned node_modules on a fresh checkout is a known rough
  # edge of this path (container runs as root); acceptable for a disposable
  # QA container. Upgrade path if it bites: --user "$(id -u):$(id -g)" on the
  # service, or run `bun install` on the host first.
  bun install --frozen-lockfile
fi

mkdir -p data/qa

echo "[hub-qa] applying drizzle/*.sql to data/qa/minion_hub.db (libsql)"
TURSO_DB_URL="file:./data/qa/minion_hub.db" bun src/server/run-migrations.ts

echo "[hub-qa] syncing SvelteKit generated types"
bunx svelte-kit sync

echo "[hub-qa] starting vite dev on 0.0.0.0:5199"
exec bun run dev -- --host 0.0.0.0 --port 5199 --strictPort
