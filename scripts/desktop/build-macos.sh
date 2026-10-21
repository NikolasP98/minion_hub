#!/usr/bin/env bash
set -euo pipefail
# Signing material exists only in the protected, master-only signed build step.
node scripts/desktop/release.mjs prepare "$DESKTOP_VERSION" "$DESKTOP_PLATFORM"
if [[ "$DESKTOP_SIGNED" == true ]]; then
  key_path="$RUNNER_TEMP/minion-apple-api.p8"
  cert_path="$RUNNER_TEMP/minion-apple.p12"
  keychain_path="$RUNNER_TEMP/minion-signing.keychain-db"
  keychain_password="$(openssl rand -hex 32)"
  trap 'security delete-keychain "$keychain_path" || true; rm -f "$key_path" "$cert_path"' EXIT
  umask 077
  printf '%s' "$APPLE_API_PRIVATE_KEY" > "$key_path"
  export APPLE_API_KEY_PATH="$key_path"
  printf '%s' "$APPLE_CERTIFICATE" | base64 --decode > "$cert_path"
  security create-keychain -p "$keychain_password" "$keychain_path"
  security set-keychain-settings -lut 21600 "$keychain_path"
  security unlock-keychain -p "$keychain_password" "$keychain_path"
  security import "$cert_path" -P "$APPLE_CERTIFICATE_PASSWORD" -k "$keychain_path" -T /usr/bin/codesign -T /usr/bin/security
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain_path"
  security list-keychains -d user -s "$keychain_path"
  unset APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD
  bun run tauri build --ci --target "$DESKTOP_TARGET" --config "$DESKTOP_CONFIG" -- --locked
  app_path="src-tauri/target/$DESKTOP_TARGET/release/bundle/macos/Minion Hub.app"
  codesign --verify --deep --strict --verbose=2 "$app_path"
  codesign -dv --verbose=4 "$app_path" 2> "$RUNNER_TEMP/minion-codesign.txt"
  grep -Fx "TeamIdentifier=$APPLE_TEAM_ID" "$RUNNER_TEMP/minion-codesign.txt"
  grep -F 'Authority=Developer ID Application:' "$RUNNER_TEMP/minion-codesign.txt"
  spctl --assess --type execute --verbose=2 "$app_path"
  xcrun stapler validate "$app_path"
  # Require the distributable DMG's own notarization ticket as well.
  for dmg in "src-tauri/target/$DESKTOP_TARGET/release/bundle/dmg/"*.dmg; do
    codesign --force --sign "$APPLE_SIGNING_IDENTITY" --timestamp "$dmg"
    codesign --verify --strict "$dmg"
    xcrun notarytool submit "$dmg" --key "$key_path" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" --wait
    xcrun stapler staple "$dmg"
    xcrun stapler validate "$dmg"
  done
else
  bun run tauri build --ci --no-sign --target "$DESKTOP_TARGET" --config "$DESKTOP_CONFIG" -- --locked
fi
node scripts/desktop/release.mjs collect "$DESKTOP_VERSION" "$DESKTOP_PLATFORM" "$GITHUB_SHA"
