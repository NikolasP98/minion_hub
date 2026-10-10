#!/usr/bin/env bash
set -euo pipefail

: "${RUNNER_TEMP:?}"
: "${PUBLISHER_IMAGE:?}"
: "${PUBLISHER_TRUSTED_DIR:?}"
: "${PUBLISHER_AUTHORITY_FILE:?}"
: "${PUBLISHER_ARTIFACT_DIR:?}"
: "${PUBLISHER_GH_PATH:?}"
: "${WORKER_ARTIFACT_B2_PUBLISHER_KEY_ID:?}"
: "${WORKER_ARTIFACT_B2_PUBLISHER_APPLICATION_KEY:?}"
[[ "$PUBLISHER_IMAGE" =~ ^node@sha256:[0-9a-f]{64}$ ]] || exit 1

root=$(mktemp -d "$RUNNER_TEMP/private-worker-publisher.XXXXXX")
chmod 0700 "$root"
cidfile=$root/container.cid
cleanup() {
  if [[ -s "$cidfile" ]]; then
    cid=$(cat "$cidfile")
    if [[ "$cid" =~ ^[0-9a-f]{64}$ ]]; then
      docker stop --time 5 "$cid" >/dev/null 2>&1 || true
      docker rm -f "$cid" >/dev/null 2>&1 || true
    fi
  fi
  rm -rf -- "$root"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
install -d -m 0700 "$root/inputs" "$root/scratch"
install -m 0400 "$PUBLISHER_AUTHORITY_FILE" "$root/inputs/authority.json"
install -m 0400 "$PUBLISHER_ARTIFACT_DIR/minion-hub-notification-worker.tar" "$root/inputs/"
install -m 0400 "$PUBLISHER_ARTIFACT_DIR/manifest.json" "$root/inputs/"
install -m 0400 "$PUBLISHER_ARTIFACT_DIR/attestation.jsonl" "$root/inputs/"

entry=/trusted/scripts/ops/publish-private-worker-artifact.mjs
if [[ "${MINION_ARTIFACT_TEST:-}" == 1 ]]; then
  : "${PUBLISHER_TEST_ENTRYPOINT:?}"
  entry=/trusted/$PUBLISHER_TEST_ENTRYPOINT
fi

docker run --rm --cidfile "$cidfile" --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  --pids-limit=128 --user "$(id -u):$(id -g)" \
  --ulimit fsize=1200000000:1200000000 \
  -e RUNNER_TEMP=/private-temp -e TMPDIR=/private-temp \
  -e WORKER_ARTIFACT_B2_PUBLISHER_KEY_ID \
  -e WORKER_ARTIFACT_B2_PUBLISHER_APPLICATION_KEY \
  -v "$PUBLISHER_GH_PATH:/usr/local/bin/gh:ro" \
  -v "$root/inputs:/inputs:ro" \
  -v "$PUBLISHER_TRUSTED_DIR:/trusted:ro" \
  -v "$root/scratch:/private-temp:rw" \
  "$PUBLISHER_IMAGE" node "$entry" \
  --authority=/inputs/authority.json \
  --archive=/inputs/minion-hub-notification-worker.tar \
  --manifest=/inputs/manifest.json \
  --provenance=/inputs/attestation.jsonl &
docker_client_pid=$!
wait "$docker_client_pid"
