#!/usr/bin/env bash
set -euo pipefail
: "${DESKTOP_GPG_PRIVATE_KEY:?Release signing key required}"
: "${DESKTOP_GPG_PASSPHRASE:?Release key passphrase required}"
: "${DESKTOP_GPG_FINGERPRINT:?Release key fingerprint required}"
[[ "$DESKTOP_GPG_FINGERPRINT" =~ ^[A-F0-9]{40}$ ]] || { echo 'Expected full OpenPGP fingerprint'; exit 1; }
export GNUPGHOME
GNUPGHOME="$(mktemp -d)"
trap 'gpgconf --kill gpg-agent || true; rm -rf "$GNUPGHOME"' EXIT
chmod 700 "$GNUPGHOME"
printf '%s' "$DESKTOP_GPG_PRIVATE_KEY" | gpg --batch --import
actual_fingerprint="$(gpg --batch --with-colons --list-secret-keys | awk -F: '$1 == "fpr" { print $10; exit }')"
[[ "$actual_fingerprint" == "$DESKTOP_GPG_FINGERPRINT" ]] || { echo 'Unexpected release signing key'; exit 1; }
gpg --batch --armor --export "$DESKTOP_GPG_FINGERPRINT" > "$DESKTOP_OUTPUT/release-key.asc"
for file in "$DESKTOP_OUTPUT/"*.deb "$DESKTOP_OUTPUT/"*.AppImage "$DESKTOP_OUTPUT/SHA256SUMS"; do
  printf '%s' "$DESKTOP_GPG_PASSPHRASE" | gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 \
    --local-user "$DESKTOP_GPG_FINGERPRINT" --armor --detach-sign "$file"
  gpg --batch --verify "$file.asc" "$file"
done
(cd "$DESKTOP_OUTPUT" && sha256sum --check SHA256SUMS)
