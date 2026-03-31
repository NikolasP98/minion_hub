#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Load desktop env
[[ -f .env.desktop ]] && { set -a; source .env.desktop; set +a; }
export DESKTOP=1 VITE_DESKTOP=1

# Force X11 backend for GTK (prevents dual-connection issue with XWayland on Hyprland)
export GDK_BACKEND=x11

# Build SvelteKit with adapter-node
echo "[desktop] Building SvelteKit..."
npx vite build

# Start server in background
export PORT=5959 ORIGIN=http://localhost:5959 HOST=127.0.0.1
echo "[desktop] Starting server on http://127.0.0.1:$PORT..."
node build/index.js &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null' EXIT INT TERM

# Wait for server (max 15s)
for i in $(seq 1 30); do
  curl -sf http://127.0.0.1:$PORT > /dev/null 2>&1 && break
  kill -0 $SERVER_PID 2>/dev/null || { echo "[desktop] Server died"; exit 1; }
  sleep 0.5
done

if ! curl -sf http://127.0.0.1:$PORT > /dev/null 2>&1; then
  echo "[desktop] ERROR: Server did not start within 15 seconds."
  exit 1
fi
echo "[desktop] Server ready."

# Build Electrobun (bundles desktop/main.ts, downloads CEF if needed)
echo "[desktop] Building Electrobun..."
npx electrobun build --env=dev

# Ensure index.js symlink exists (fixes Electrobun launcher bug:
# launcher expects bun/index.js but CLI produces bun/main.js)
APP_BUN_DIR=$(find build/dev-linux-x64 -path "*/Resources/app/bun" -type d 2>/dev/null | head -1)
if [[ -n "$APP_BUN_DIR" && -f "$APP_BUN_DIR/main.js" && ! -e "$APP_BUN_DIR/index.js" ]]; then
  ln -sf main.js "$APP_BUN_DIR/index.js"
  echo "[desktop] Created index.js symlink"
fi

# Launch the built app
echo "[desktop] Launching window..."
npx electrobun run

echo "[desktop] Window closed."
