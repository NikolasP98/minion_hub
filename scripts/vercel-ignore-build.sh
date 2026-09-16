#!/usr/bin/env bash
# Vercel "Ignored Build Step" (vercel.json → ignoreCommand).
# Exit 0 = skip this deployment, exit 1 = build it.
# Production always builds (its build also runs the DB migration gate).
# Previews are skipped when the pushed commit touches only paths that cannot
# change the deployed app: CI, docs, tests, the local QA stack, planning files.
set -u
if [ "${VERCEL_ENV:-}" = "production" ]; then exit 1; fi
# Compare against the previous deployment of this branch when Vercel tells us
# which commit that was (a push can carry several commits); otherwise the
# parent commit. If the base is not in the shallow clone, build to be safe.
base="${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}"
if ! git rev-parse -q --verify "${base}^{commit}" >/dev/null 2>&1; then exit 1; fi
changed=$(git diff --name-only "$base" HEAD)
if [ -z "$changed" ]; then exit 1; fi
ignorable='^(\.github/|docs/|scripts/qa/|supabase/qa/|supabase/config\.toml|tests/|proposals/|specs/|docker-compose\.qa\.yml|\.gitignore|\.prettierignore|CLAUDE\.md|AGENTS\.md|README)|\.md$'
if printf '%s\n' "$changed" | grep -vE "$ignorable" | grep -q .; then
  exit 1
fi
echo "vercel-ignore-build: only non-app paths changed; skipping preview build"
exit 0
