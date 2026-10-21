#!/usr/bin/env bash
set -euo pipefail
node scripts/desktop/release.mjs prepare "$DESKTOP_VERSION" "$DESKTOP_PLATFORM"
# Keep the linker's Apple Silicon ad-hoc integrity metadata intact. We select
# the updater target explicitly, so per-installer binary patching is unnecessary.
# No publisher identity, certificate or notarization account is used.
bun run tauri build --ci --no-sign --no-binary-patching --target "$DESKTOP_TARGET" --config "$DESKTOP_CONFIG" -- --locked
if [[ "$DESKTOP_TARGET" == "aarch64-apple-darwin" ]]; then
  app="$DESKTOP_BUNDLE/macos/Minion Hub.app"
  executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Contents/Info.plist")"
  codesign --verify --strict "$app/Contents/MacOS/$executable"
fi
node scripts/desktop/release.mjs collect "$DESKTOP_VERSION" "$DESKTOP_PLATFORM" "$GITHUB_SHA"
node scripts/desktop/updates.mjs collect "$DESKTOP_VERSION" "$DESKTOP_PLATFORM" "$GITHUB_SHA"
