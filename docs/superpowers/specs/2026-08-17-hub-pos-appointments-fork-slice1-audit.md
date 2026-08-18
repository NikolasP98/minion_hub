# Slice 1 audit — `/pos/appointments` vs `/scheduling/bookings` fork

Spec: `2026-08-17-hub-pos-appointments-fork-spec`, Slice 1 (differential audit +
characterization harness). This slice writes no production code — only the
pinning test suite (`src/routes/(app)/scheduling/bookings/bookings-routes.characterization.test.ts`)
that Slices 2-3 must leave green while extracting a shared `BookingsView`.

This document is the durable record of §2.1-§2.3's required deliverables. It
lives in-repo (rather than only in the PR body) because this harness stage
edits code, not PR metadata — see the note at the end.

## §1 Discovery contract (run against `dev` tree)

- **1.1** — `pos/appointments/+page.svelte` 732 lines, `scheduling/bookings/+page.svelte`
  659 lines — matches the spec's claimed sizes.
- **1.4** — the availability manifest from `2026-07-22-hub-routing-simplification-spec`
  DID ship (`src/lib/modules/availability.ts` — `posAppointments: { appPrefixes:
  ['/pos/appointments'], requires: ['pos','scheduling'] }`), enforced centrally via
  `isAppRouteBlocked` (the `(app)` hook guard). RBAC is a separate, standalone
  `route-access-registry.ts` entry (`MODULE_SUBRESOURCES.pos['pos.appointments']`
  → policy id `permission:pos.appointments:view`) — confirmed independent of the
  availability manifest per §R1.
- **1.6 baseline** (untouched tree): `bun run check` 0/0. Full suite: 1 failed test
  file / 2759 passed tests / 2 skipped. The one failure, `scripts/ui-audit-inventory.test.ts`,
  is environmental — `git rev-parse 857a94b7...^{commit}` fails in a shallow/worktree
  clone missing that commit object, unrelated to this diff. Recorded as the
  pre-existing baseline; this slice's own suite (14 new tests, later expanded to
  22 — see below) is 100% green and the full suite afterward is unchanged aside
  from the new passing tests.

## §2.1 Differential matrix (capability · scheduling/bookings · pos/appointments)

| Capability | scheduling/bookings | pos/appointments |
|---|---|---|
| Data keys returned | bookings, resources, eventTypes, stockEnabled, contactId, contactName, openNew, accrualSummaries | bookings, resources, eventTypes, stockEnabled, accrualSummaries (no contact*/openNew — **scheduling-only**) |
| Date window | `?contact=` present → unwindowed contact query; else now-30d..now+90d | fixed today 00:00 (server-local) .. +7d, never overridable — **preset/locked** |
| Resource list | all resources, `{id,name}` | `.filter(r => r.active)` before mapping — **POS-only** filter |
| stockEnabled | `effectiveModuleEnabled(orgKind, moduleStates, 'stock')` (kind-aware) | `locals.moduleStates?.stock ?? true` (kind-**unaware**) — **same intent, different implementation**: real drift, not cosmetic. Preserved verbatim (out of scope per §7) |
| Accrual read | conditional on stockEnabled, try/catch | unconditional try/catch regardless of stockEnabled — **same intent, different implementation** |
| Sort | none applied in load or template (service default: `orderBy(desc(startTime))`) | client `$derived` re-sorts ascending by startTime after filtering — **POS-only** |
| Filters (UI) | none (flat list) | today/week client toggle over the already-narrow 7d window — **POS-only**, locked date range underneath |
| Contact scoping | `?contact=` supported (ScopeBanner, unwindowed query, prefilled new-appt form) | not read at all — **scheduling-only** |
| Grouping | flat list | day-bucketed groups with a caption header — **POS-only** |
| Row action: complete/no-show/cancel | present, gated `canAct('scheduling','edit')`, shown for accepted/pending | identical gating/shape — **identical** |
| Row action: create sales order | present (`!isPersonal && status not cancelled/rejected`) → POST `/api/scheduling/bookings/:id/order` → goto `/sales` — the known §R6 kind-leak, preserved verbatim | **absent** — **scheduling-only** |
| Row action: charge to POS | absent | present, `status === 'completed' && canAct('pos','edit')` → writes `pos-charge-{orgId}` to localStorage, goto `/pos/sell` — **POS-only** |
| Page action: new booking | Button labelled `sched_bookings_title()` (same string as the page title — looks like a copy/paste artifact, preserved verbatim, not this slice's job to fix) | Button labelled `pos_appt_new()`, plus a forced-staff + off-grid "walk-in override" block in the modal and a shared `CustomerPicker` component instead of hand-rolled name/phone/contact-search fields — **POS-only** |
| Empty state | `EmptyState` w/ `sched_empty_bookings()` | identical component + key — **identical** |
| Complete-dialog / stock-warning UI | shared implementation (POS's is a verbatim copy per its own comment) | **identical** |
| i18n | `sched_bookings_title`, `sched_dashboard_subtitle`, `sched_book_name`, `sched_book_phone`, `sched_book_find_client` | `pos_nav_appointments`, `nav_pos`, `pos_appt_today/week/new/charge/staff_any`, `pos_walkin_override` — **different words for the same page** (title: "Bookings" vs "Appointments"); most `sched_*` booking-modal/status/stock keys are shared |
| Realtime | `invalidate('scheduling:data')` after mutations | `invalidate('pos:appointments')` — different `depends()` keys, same pattern — **identical shape, different key** |
| Archetype (manifest) | `collection`, scroll `region` | manifest says `workspace-editor`, scroll `region`, but the page's own `<PageShell archetype="collection">` prop is hardcoded to `collection` — **drift**: the rendered shell already IS a collection today; flagged for Slice 3/4 §4.2 trap 3 (archetype correction candidate), not resolved here |
| RBAC policy id | `permission:scheduling:view` (via `/scheduling` prefix rule) | `permission:pos.appointments:view` (own `MODULE_SUBRESOURCES` entry, longest-prefix beats `/pos` → `pos:view`) — confirmed independent per §R1 |

## §2.3 Branch decision: **view**

(a) POS-only affordances are non-empty (charge-to-POS, day grouping, today/week
toggle, walk-in override + force-resource, `CustomerPicker`) — this alone
disqualifies the redirect branch per §0's rule ("a non-empty POS-only column
means view, full stop"). (b)/(c) not evaluated since (a) already decides it.
**Default (view) confirmed.**

## Red-state proof

The `stockEnabled` assertion for `/pos/appointments` was first written expecting
`effectiveModuleEnabled`-style gating (`false` for a personal-kind org with
stock toggled on) and failed as expected:

```
AssertionError: expected true to be false
- false
+ true
 ❯ .../bookings-routes.characterization.test.ts:181:33
```

...because the POS load actually reads `locals.moduleStates?.stock ?? true`
directly — a real drift from the scheduling side, not a copy-paste artifact.
Corrected back to `true` (what the fork actually returns), confirming the
suite characterizes real behaviour rather than asserting a tautology. See
`bookings-routes.characterization.test.ts` — "reads stockEnabled straight off
moduleStates" test.

## Characterization suite

`src/routes/(app)/scheduling/bookings/bookings-routes.characterization.test.ts`
pins, for both `load` functions:

- the exact returned key set;
- the full `bookings`/`eventTypes`/`accrualSummaries` payload against a
  representative fixture (not just top-level keys);
- the exact `listBookings` call args, including the precise scheduling
  (now-30d/now+90d) and POS (today/+7d) date-window bounds under frozen time,
  and the RBAC-derived `maskAttendeePii` flag for both `true`/`false`;
- the `stockEnabled` kind-leak drift (pinned verbatim per §7 out-of-scope);
- both routes' `route-design-manifest.ts` entries (archetype/scroll/accessPolicyId);
- `route-access-registry.ts` — standalone `pos.appointments` RBAC entry;
- the composite availability gate (`isAppRouteBlocked`) requires BOTH `pos` and
  `scheduling` for `/pos/appointments`, and scheduling has no such dependency.

Only this test file (plus this doc) changes production-adjacent surfaces —
no `.svelte`/`.server.ts` edits in this slice, per its own DoD.

## Note on where this deliverable lives

FACTORY_SPEC.md §2.1 calls the differential matrix a "PR-body deliverable."
The develop-stage harness that authored this slice is not permitted to edit
PR bodies (code changes only), so the matrix/decision/red-state proof are
recorded here instead, where they are durable and versioned with the code
they characterize. **Handoff:** a human or a stage with PR-edit authority
should still copy this document's content into PR #126's body to satisfy the
spec's literal requirement.
