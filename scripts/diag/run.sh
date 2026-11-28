#!/bin/bash
# DIAG ONLY (branch diag/webkit-flake, never merged): build + serve the critical fixture on loopback, loop journeys.
set -u
R="$RUNNER_TEMP/diag"; mkdir -p "$R/evidence"
export CI=1 NODE_OPTIONS=--max-old-space-size=1536
MINION_CRITICAL_OUT=$R/build MINION_CRITICAL_EVIDENCE=$R/evidence node tests/fixtures/critical-journeys/build.mjs > "$R/build.log" 2>&1 || { tail -30 "$R/build.log"; exit 1; }
MINION_CRITICAL_OUT=$R/build MINION_CRITICAL_RUN_ID=diag node tests/fixtures/critical-journeys/serve.mjs > "$R/serve.log" 2>&1 &
SP=$!
for i in $(seq 100); do curl -sf -o /dev/null http://127.0.0.1:18903/eval.html && break; sleep 0.2; done
python3 scripts/diag/sampler.py "$PLAYWRIGHT_BROWSERS_PATH" "$R/evidence/procs.log" &
SA=$!
DEBUG=pw:browser MINION_CRITICAL_URL=http://127.0.0.1:18903 MINION_CRITICAL_OUT=$R/build MINION_CRITICAL_EVIDENCE=$R/evidence \
  node node_modules/@playwright/test/cli.js test --config playwright.critical.config.ts --reporter=list "$@" 2> "$R/evidence/browser-stderr.log"
rc=$?
kill $SP $SA
echo "playwright exit $rc"
exit 0
