# PR #118 current-master reconciliation

Issue: [#205](https://github.com/NikolasP98/minion_hub/issues/205)

Recovery source: closed draft [#118](https://github.com/NikolasP98/minion_hub/pull/118) at
`fe2014a8f68c5592e4b6abbd9d42b19856c8b83e`

Compared base: `origin/master` at `27013e555ce396431876dc0c45fe431ba56eae09`
(repository default branch verified as `master` on 2026-08-30)

Merge base: `1b47e8ced0751eeb301c9a24d16082f36fe48f78`

## Decision

Do not merge or rebase #118. No product code should be extracted until this reconciliation is
reviewed. The retained head has 96 changed paths against current `master`: 29 are absent from
`master` and 67 have diverged; zero are byte-identical. “Already shipped” below therefore means
the behavior is present or superseded on current `master`, not that the old blob is safe to copy.

The smallest safe successor order is:

1. Finance sync/source reliability (safe extraction, excluding live-provider verification).
2. Social dashboard/read-only KPI behavior and EditableGrid, as separate UI slices.
3. CRM identity/range remnants only where focused current-base tests prove a behavioral gap.
4. Organization provisioning only after an idempotent, ID-addressed design is approved.
5. Project/factory integration only after repository-scoped authority and head-bound gate evidence
   are approved.

Platform/performance and diagnostic material has no successor by default; it must first demonstrate
a current-base regression or an operational owner.

## File-by-file disposition

Legend: **drop** = already shipped/superseded; **extract** = safe unique WIP candidate;
**redesign** = unsafe unique WIP; **archive** = obsolete or evidence-only.

| Disposition | Path                                                                      | Evidence / successor boundary                                                                      |
| ----------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| archive     | `AGENTS.md`                                                               | Historical branch-local agent instructions; `CLAUDE.md` is current law.                            |
| archive     | `docs/reports/2026-07-15-dni-validation-backfill.md`                      | Point-in-time audit; preserve at retained head, not runtime.                                       |
| archive     | `docs/reports/2026-07-25-connection-capacity-realtime-messaging-audit.md` | Point-in-time audit; operational conclusions require remeasurement.                                |
| archive     | `docs/reports/susii-null-total-dryrun.md`                                 | SUSII-era dry-run evidence is obsolete after the SUNAT cutover.                                    |
| extract     | `messages/en.json`                                                        | Extract only keys required by an approved bounded UI slice.                                        |
| extract     | `messages/es.json`                                                        | Must remain paired with the English keys and compile via Paraglide.                                |
| archive     | `scripts/audit-conversation-corpus.ts`                                    | One-off audit; no current owner or runtime caller.                                                 |
| drop        | `scripts/design-lint.mjs`                                                 | Current design governance supersedes the old branch delta.                                         |
| archive     | `scripts/diag-susii-backfill-dryrun.ts`                                   | SUSII diagnostic; retained head is sufficient archive.                                             |
| archive     | `scripts/diag-susii-jun1-gap.ts`                                          | SUSII incident diagnostic, not product code.                                                       |
| archive     | `scripts/diag-susii-null-total.ts`                                        | SUSII incident diagnostic, not product code.                                                       |
| archive     | `scripts/diag-susii-reconcile.ts`                                         | SUSII incident diagnostic, not product code.                                                       |
| archive     | `scripts/diag-susii-total-derivation.ts`                                  | SUSII incident diagnostic, not product code.                                                       |
| drop        | `scripts/ui-audit-inventory.test.ts`                                      | Old route counts cannot be transplanted; regenerate for any new route.                             |
| archive     | `scripts/verify-conversation-brain.ts`                                    | One-off verification tool; revalidate against Qdrant-owned current architecture if revived.        |
| extract     | `src/app.css`                                                             | Density changes only as a measured, standalone UI slice.                                           |
| drop        | `src/lib/automations/system-automations.ts`                               | Current automation manifest/cadences supersede the stale two-tick claim.                           |
| extract     | `src/lib/components/dashboard/EditableGrid.svelte`                        | Unique UX candidate; isolate from socials and rerun design gates.                                  |
| extract     | `src/lib/components/dashboard/date-range/date-range.test.ts`              | Socials dependency: port only the retained `bucketKey` behavior test; keep current range tests.    |
| extract     | `src/lib/components/dashboard/date-range/index.ts`                        | Socials dependency: export only `bucketKey`; keep the current barrel otherwise authoritative.      |
| extract     | `src/lib/components/dashboard/date-range/periods.ts`                      | Socials dependency: port only `bucketKey`; current inclusive-range behavior remains authoritative. |
| extract     | `src/lib/components/my-agent/ChatInput.svelte`                            | Only with the standalone density slice.                                                            |
| extract     | `src/lib/components/my-agent/EmailCard.svelte`                            | Only with the standalone density slice.                                                            |
| extract     | `src/lib/components/my-agent/EventCard.svelte`                            | Only with the standalone density slice.                                                            |
| extract     | `src/lib/components/my-agent/FeedCard.svelte`                             | Only with the standalone density slice.                                                            |
| extract     | `src/lib/components/my-agent/FeedSection.svelte`                          | Only with the standalone density slice.                                                            |
| drop        | `src/lib/components/my-agent/OmnichatDock.svelte`                         | Current master contains later omnichat ordering/scoping fixes; do not regress it.                  |
| drop        | `src/lib/components/overview/OverviewGraph.svelte`                        | Relationship/party-spine work on current master supersedes this branch edit.                       |
| drop        | `src/lib/components/overview/graph/build-graph.ts`                        | Same relationship-graph supersession; prove a current gap before reviving.                         |
| extract     | `src/lib/components/scheduling/BookingsView.svelte`                       | Only with the booking-to-sales ownership slice and current RBAC contract.                          |
| drop        | `src/lib/pii.test.ts`                                                     | Current field-level masking tests are authoritative; transplant no stale test fixtures.            |
| redesign    | `src/lib/routes/route-design-contracts.test.ts`                           | Consequence of the unsafe repo route; regenerate only if that route is approved.                   |
| redesign    | `src/lib/routes/route-design-manifest.ts`                                 | Same; new route requires the complete current six-count contract update.                           |
| redesign    | `src/lib/routes/route-design-validation.ts`                               | Same; never copy old pinned counts.                                                                |
| extract     | `src/lib/state/features/finance-sync.svelte.ts`                           | Bounded finance reliability slice; expose stalled state only if UI consumes it.                    |
| redesign    | `src/lib/workforce/factory-gates.test.ts`                                 | Tests encode globally stale review decisions rather than head/round-bound evidence.                |
| redesign    | `src/lib/workforce/factory-gates.ts`                                      | High finding: old approval can satisfy later gate rounds.                                          |
| drop        | `src/routes/(app)/+layout.server.ts`                                      | Current canonical auth/RBAC load flow is authoritative.                                            |
| drop        | `src/routes/(app)/crm/[contactId]/+page.svelte`                           | Current party spine owns DNI/DOB/age; only reopen with a failing shipped-path test.                |
| drop        | `src/routes/(app)/finances/+page.server.ts`                               | Current finance rollups supersede this branch query delta.                                         |
| extract     | `src/routes/(app)/finances/settings/+page.svelte`                         | Finance credential UX candidate; keep providers separate and surface real errors.                  |
| extract     | `src/routes/(app)/pos/catalog/+page.svelte`                               | Only with owning-module write slice; preserve current catalog/recipe behavior.                     |
| redesign    | `src/routes/(app)/settings/organizations/+page.server.ts`                 | Provisioning reads must address orgs by ID and expose current trace state safely.                  |
| redesign    | `src/routes/(app)/settings/organizations/+page.svelte`                    | High finding: unconditional rerun can duplicate workstation resources.                             |
| redesign    | `src/routes/(app)/settings/organizations/page.server.test.ts`             | Replace with real idempotency/rerun tests against shipped service boundaries.                      |
| extract     | `src/routes/(app)/socials/+page.server.ts`                                | Read-only slice; latest-sync must filter `status === 'succeeded'`.                                 |
| extract     | `src/routes/(app)/socials/+page.svelte`                                   | UI slice after correcting freshness and 500-campaign KPI undercount.                               |
| redesign    | `src/routes/(app)/workforce/projects/[id]/+page.svelte`                   | Separate project metadata UX from external GitHub authority.                                       |
| redesign    | `src/routes/(app)/workforce/projects/[id]/repo/+page.server.ts`           | New external-authority route; requires current RBAC and scoped credentials.                        |
| redesign    | `src/routes/(app)/workforce/projects/[id]/repo/+page.svelte`              | Do not expose gates until evidence is tied to current round/head.                                  |
| drop        | `src/routes/api/crm/dni-lookup/+server.ts`                                | Current party-spine server write is the identity authority.                                        |
| extract     | `src/routes/api/finances/sources/+server.ts`                              | Rebuild from current provider enum/RBAC; reject partial secrets including client secret.           |
| extract     | `src/routes/api/finances/sources/sources.server.test.ts`                  | Port behaviors, not mocks; add client-secret-only regression coverage.                             |
| extract     | `src/routes/api/finances/sync/status/+server.ts`                          | Bounded stalled-job recovery behavior with current write capability.                               |
| drop        | `src/routes/api/gateway/lease/+server.ts`                                 | Current channel-aware gateway lease path supersedes this cache-only delta.                         |
| drop        | `src/routes/api/gateway/query/finance/+server.ts`                         | Current org-scoped finance query path is authoritative.                                            |
| redesign    | `src/routes/api/organizations/provision/+server.ts`                       | High finding: heal recomputes slug; target existing organization by ID.                            |
| extract     | `src/routes/api/pos/sellables/+server.ts`                                 | Owning-module gate candidate, isolated from route removal.                                         |
| extract     | `src/routes/api/pos/sellables/[id]/+server.ts`                            | Same bounded owning-module gate.                                                                   |
| extract     | `src/routes/api/pos/sellables/_owning-modules.test.ts`                    | Port against the shipped handlers, not a copied helper.                                            |
| extract     | `src/routes/api/pos/sellables/_owning-modules.ts`                         | Safe only if current RBAC cannot express the owner-module rule centrally.                          |
| redesign    | `src/routes/api/projects/[id]/preview/+server.ts`                         | External stop authority needs repo/project ownership proof and least privilege.                    |
| redesign    | `src/routes/api/projects/[id]/preview/server.test.ts`                     | Must test scoped authorization and stale-head rejection.                                           |
| redesign    | `src/routes/api/projects/[id]/repo/+server.ts`                            | Repository-scoped GitHub authority is unresolved High-risk design work.                            |
| redesign    | `src/routes/api/projects/[id]/repo/review/+server.ts`                     | Bind decision to repo, gate round, commit head, and distinguish comment/request-changes.           |
| extract     | `src/routes/api/sales/orders/from-booking/+server.ts`                     | Candidate owning-module endpoint; add current sales capability and idempotency tests.              |
| extract     | `src/routes/api/scheduling/bookings/[id]/order/+server.ts`                | Remove only in the same route-move slice; update route contract and consumers together.            |
| drop        | `src/server/db/pg-ledger-client.ts`                                       | Current org-scoped database helper is authoritative.                                               |
| archive     | `src/server/finance/SUNAT-API-REFERENCE.md`                               | Branch copy is stale; preserve current operational docs.                                           |
| extract     | `src/server/finance/connectors/susii-client.test.ts`                      | Only behavioral tests still relevant to a live compatibility connector.                            |
| archive     | `src/server/finance/connectors/susii-client.ts`                           | Do not expand deprecated SUSII runtime; SUNAT is the current path.                                 |
| drop        | `src/server/services/brain-corpus.service.ts`                             | Current Qdrant-owned corpus pipeline supersedes the old performance delta.                         |
| extract     | `src/server/services/finance-sync-jobs.service.test.ts`                   | Port stalled/dead-job behaviors into a finance reliability slice.                                  |
| extract     | `src/server/services/finance-sync-jobs.service.ts`                        | Safe bounded recovery/alert candidate with current job schema.                                     |
| redesign    | `src/server/services/github-api.ts`                                       | Broad GitHub client is the authority boundary that must become repository-scoped.                  |
| redesign    | `src/server/services/github-issues.service.ts`                            | Preserve current service until a scoped shared client is approved.                                 |
| redesign    | `src/server/services/github-repos.service.test.ts`                        | Add negative cross-repo and stale-head tests before implementation.                                |
| redesign    | `src/server/services/github-repos.service.ts`                             | Unsafe unique WIP: repository authority and review evidence are not sufficiently scoped.           |
| drop        | `src/server/services/hosts.service.ts`                                    | Current active-org/channel-aware host resolution supersedes this cache delta.                      |
| drop        | `src/server/services/messages.service.ts`                                 | Current org-scoped idempotency/broadcast implementation supersedes it.                             |
| extract     | `src/server/services/meta/ad-performance.service.ts`                      | Add an unbounded aggregate before claiming all-campaign conversation totals.                       |
| extract     | `src/server/services/meta/meta-insights.service.ts`                       | Read-only KPI slice, verified against current pagination semantics.                                |
| extract     | `src/server/services/meta/meta-sync.service.ts`                           | Gate attribution backfill on terminal page (`!result.cursor`).                                     |
| redesign    | `src/server/services/organization-provision.service.test.ts`              | Must prove reruns reuse existing workstation and organization shell.                               |
| redesign    | `src/server/services/organization-provision.service.ts`                   | Unsafe unique WIP: workstation provisioning is not idempotent.                                     |
| redesign    | `src/server/services/organizations.service.ts`                            | Kind/owner changes belong with the approved provisioning data model.                               |
| drop        | `src/server/services/party-dni-apply.test.ts`                             | Current party-spine tests supersede the branch's separate DNI apply path.                          |
| drop        | `src/server/services/party.service.ts`                                    | Current master has later party-spine identity behavior.                                            |
| redesign    | `src/server/services/preview-runner.service.ts`                           | Stop action requires scoped authority plus ownership proof at current head.                        |
| redesign    | `src/server/services/projects.service.ts`                                 | Repository linkage schema belongs with the external-authority design.                              |
| extract     | `src/server/services/pulse.service.ts`                                    | Only after cache-bust failures become fail-open after committed mutations.                         |
| extract     | `src/server/services/rbac.service.test.ts`                                | Port only assertions required by an approved bounded route/API slice.                              |
| extract     | `src/server/services/rbac.service.ts`                                     | Re-derive permissions per approved slice; never copy the branch delta wholesale.                   |
| redesign    | `src/server/ui-audit/frontend-contract-scanner.test.ts`                   | Consequence of unsafe repo route; regenerate current counts if approved.                           |
| redesign    | `supabase/migrations/20260802210000_org_provision_runs.sql`               | Migration and schema must be redesigned together; define retention/FK policy first.                |
| redesign    | `tests/ui-audit/current-baseline.json`                                    | Generated consequence of repo route; regenerate rather than transplant.                            |

## Review findings that block extraction

- Organization heal provisions a workstation unconditionally, while the UI exposes rerun even for
  successful traces. A successor must first look up and reuse the existing default shell and test a
  second run as a no-op.
- The heal endpoint identifies the target using a recomputed slug. A successor must carry the
  existing organization ID end to end.
- Factory gate derivation accepts a globally latest review, allowing old approval to satisfy a new
  gate/head. Evidence must include repository, gate round, and commit SHA.
- GitHub mutations are mediated by a broad client. A successor must enforce repository-scoped
  authority server-side; a project row or client-supplied repo name is not sufficient authority.

The Socials UI extraction is not standalone: retained `+page.svelte` imports `bucketKey` and uses it
to roll its already-loaded daily series into week/month/year buckets. Current `master` has no such
export. Therefore that slice must port the retained `periods.ts` helper, its `index.ts` export, and
the focused real-module test from `date-range.test.ts` together. The other retained date-range hunks
remain dropped because current `master` already owns their inclusive-range behavior.

## Verification recipe for successors

Every successor starts from then-current `master`, cites the exact source paths/commits above, and
runs focused behavior tests plus `bun run check`. UI slices additionally run
`DESIGN_LINT_BASE_REF=origin/master bun run lint:design` and `bun run lint:tokens`; i18n keys require
`bun run i18n:compile`; routes require the manifest and all six count sites; writes require current
RBAC coverage. Provisioning and factory slices additionally require the conditional external
no-mistakes release gate specified by #205.
