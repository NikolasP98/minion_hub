#!/usr/bin/env bash
# Fix Electrobun Linux bug: launcher expects bun/index.js but CLI produces bun/main.js
BUILD_DIR="${ELECTROBUN_BUILD_DIR:-build/dev-linux-x64}"
APP_BUN_DIR=$(find "$BUILD_DIR" -path "*/Resources/app/bun" -type d 2>/dev/null | head -1)
if [[ -n "$APP_BUN_DIR" && -f "$APP_BUN_DIR/main.js" && ! -f "$APP_BUN_DIR/index.js" ]]; then
  ln -sf main.js "$APP_BUN_DIR/index.js"
  echo "[postbuild] Created index.js symlink in $APP_BUN_DIR"
fi
