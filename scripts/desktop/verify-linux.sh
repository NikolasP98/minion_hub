#!/usr/bin/env bash
set -euo pipefail
# Inspect the packaged launcher, not just the source template. An omitted URI
# placeholder registers the scheme but silently discards the link on launch.
launcher="$(mktemp)"
trap 'rm -f "$launcher"' EXIT
ar p "$1" data.tar.gz | tar -xzO 'usr/share/applications/Minion Hub.desktop' > "$launcher"
grep -Eq '^Exec=minion-hub-desktop %[uU]$' "$launcher"
grep -Eq '^MimeType=x-scheme-handler/minion;?$' "$launcher"
