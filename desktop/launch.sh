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

# Launch Electrobun CEF window
echo "[desktop] Launching window..."
npx electrobun dev

echo "[desktop] Window closed."
