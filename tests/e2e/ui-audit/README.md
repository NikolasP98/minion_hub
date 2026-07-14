# Deterministic UI audit harness

The capture suite inventories every SvelteKit page endpoint, verifies the seven redirect contracts, and captures every renderable screen against four fixed personas and three viewport classes.

Provision a disposable local Supabase stack with all Hub migrations applied, then run:

```bash
bun run audit:ui:seed
set -a; source .env.ui-audit.local; set +a
bun run audit:ui:capture
```

Use `bun run audit:ui:seed --reset` to delete/recreate only the four `ui-audit-*@minion.test` identities before reseeding. The command refuses non-local Supabase hosts and never stores production IDs, cookies, service keys, or passwords in Git. `.env.ui-audit.local` is mode `0600` and covered by `.gitignore`.

The seed performs a bounded relation-and-column preflight before it creates or resets any identity. If it reports missing base schema, stop and reconcile the disposable stack's shared and Hub-owned migration history; do not point the seed at a hosted/production project and do not mark migrations applied merely to bypass the check. During the 2026-07-13 verification run, the existing local stack had schema/history drift (including missing Hub domain tables), so no deterministic persona/viewport capture was certified from that stack.

The seed owns the audit organization, persona role assignments, and Hub-native database fixtures. Gateway/Paperclip-backed detail routes use stable simulator contract IDs (`ui-audit-session`, `ui-audit-shell`, and `ui-audit-workforce-*`); configure local gateway/Paperclip simulators with those IDs when the capture must exercise populated external states. Without the simulators, the same URLs still produce deterministic unavailable/empty states and are recorded as such in the machine-readable run.

Capture each persona and viewport explicitly:

```bash
for persona in owner manager member restricted; do
  for viewport in wide medium compact; do
    E2E_UI_AUDIT_PERSONA=$persona E2E_UI_AUDIT_VIEWPORT=$viewport bun run audit:ui:capture
  done
done
```

Outputs are written under `test-results/ui-audit/`. `tests/ui-audit/current-baseline.json` is the immutable pre-program endpoint ledger; regenerate only when the route surface intentionally changes.

Each route result records console errors, uncaught page errors, failed requests,
failed same-origin GET responses, document overflow, duplicate IDs, accessible
names for controls/dialogs, form-button types, invalid local links, visible route
titles, and sub-24px interactive targets. The capture fails immediately for the
critical deterministic invariants: unexplained document overflow, duplicate IDs,
unnamed controls/dialogs, implicit form buttons, or empty/hash-only local links.
Small target findings remain recorded for route review because authored canvas,
terminal, and dense-data controls need context rather than a global exception.
