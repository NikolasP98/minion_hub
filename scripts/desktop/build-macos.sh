#!/usr/bin/env bash
set -euo pipefail
node scripts/desktop/release.mjs prepare "$DESKTOP_VERSION" "$DESKTOP_PLATFORM"
bun run tauri build --ci --no-sign --target "$DESKTOP_TARGET" --config "$DESKTOP_CONFIG" -- --locked
node scripts/desktop/release.mjs collect "$DESKTOP_VERSION" "$DESKTOP_PLATFORM" "$GITHUB_SHA"
node scripts/desktop/updates.mjs collect "$DESKTOP_VERSION" "$DESKTOP_PLATFORM" "$GITHUB_SHA"
