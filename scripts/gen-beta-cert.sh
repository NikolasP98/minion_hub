#!/usr/bin/env bash
# Self-signed test cert for SUNAT's beta sandbox — no registered certificate
# required in beta. Output is gitignored (.beta-cert/); NEVER commit key material.
set -euo pipefail

OUT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.beta-cert"
mkdir -p "$OUT_DIR"

openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout "$OUT_DIR/key.pem" \
  -out "$OUT_DIR/cert.pem" \
  -subj "/C=PE/O=FACES BETA/CN=20611172967"

echo "Wrote $OUT_DIR/cert.pem + $OUT_DIR/key.pem (gitignored, beta sandbox only)"
