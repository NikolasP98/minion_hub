---
id: 2026-08-13-crm-customers-server-pagination-spec
title: "CRM Customers — DataTable server mode (pagination, sort, filter, ICP-safe)"
stage: spec
status: approved
pass: 2
created: 2026-08-13
updated: 2026-08-17
proposal: 2026-08-13-crm-customers-server-pagination
verdict: approved
repos: [minion_hub]
tags: [ui, logic]
type: feature
supersedes: 2026-08-03-crm-customers-server-pagination-spec
---

# CRM Customers — DataTable server mode

**Owner surface:** `minion_hub` — `/crm/customers`, `src/lib/components/data-table/DataTable.svelte`,
`src/server/services/crm-contacts.service.ts`, `/api/crm/contacts`
**Design ancestor:** [`specs/2026-08-03-crm-customers-server-pagination-spec.md`](2026-08-03-crm-customers-server-pagination-spec.md)
(the unimplemented design; this spec is its executable slicing — see §7)
**Coordinates with:** [`2026-08-03-crm-icp-score-spec`](2026-08-03-crm-icp-score-spec.md) (ICP column must be server-sorted),
[`2026-07-06-hub-tanstack-consolidated-execution`](2026-07-06-hub-tanstack-consolidated-execution.md) (T2 touches the same DataTable),
[`2026-07-07-hub-db-migration-pipeline`](2026-07-07-hub-db-migration-pipeline.md) (how the index migration ships)

---

## 0. Product

From the approved proposal `2026-08-13-crm-customers-server-pagination`, verbatim:

> ## Problem
>
> /crm/customers loads the full customer set client-side; at 17k+ CRM rows the page is slow
> and memory-heavy. A server-pagination spec already exists
> (`specs/2026-08-03-crm-customers-server-pagination-spec.md`) but was never implemented.
>
> ## Definition of done
>
> - DataTable on /crm/customers uses server mode (page/size/sort/filter params hit the API).
> - Initial payload ≤ 1 page of rows; sorting on the ICP-fit column stays server-side.
> - Existing spec's acceptance criteria pass.
>
> ## Out of scope
>
> - Any other CRM route; schema changes.

The design question was already settled on 2026-08-03 and re-reading it is prereq work, not
re-litigation. What was missing is an execution plan: slices a single dev can land green
one at a time without breaking the eleven other routes that share `DataTable.svelte`.
That is what this spec adds.

## 1. Assumptions and what must be verified first

**This spec was written from the meta-repo, where `minion_hub/` is not checked out** (the
meta-repo `.gitignore` excludes every subproject). Every file path, line count and API shape
below is carried over from `2026-08-03-crm-customers-server-pagination-spec.md`,
`2026-07-05-hub-tanstack-virtual.md` and `2026-07-07-hub-db-migration-pipeline.md`, and was
true when those were written. Treat them as **strong leads, not verified fact**.

Slice 0 (below, 30 min, not counted as a slice) is a mandatory reconnaissance step that
turns them into fact. If a path moved, fix it in this spec's §3 table in the same commit —
do not silently implement against a different file.

Two carried-over claims are load-bearing and singled out for verification:

1. `GET /api/crm/contacts` already returns an object with a `contacts` key (so adding
   `total` is additive, not breaking). **If it returns a bare array, the shape change is
   breaking and §5 alert A2 applies.**
2. Hub's migration runner applies each `.sql` file **inside one transaction** under
   `pg_advisory_xact_lock`. If true, `create index concurrently` **cannot** be used — see
   alert A1.

## 2. Approach

Six vertical slices. Each is ~4–8 focused hours, lands independently green, and leaves
`/crm/customers` working for users at every commit boundary. Server slices (S1–S3) ship
behind no flag because the old page keeps reading the old path until S4/S5 flips it.

```
S1 ─▶ S2 ─▶ S3 ─┬─▶ S5 ─▶ S6
                │
S4 ─────────────┘
```

S4 (component) has no dependency on S1–S3 and may be done in parallel by a second dev.

### Slice 0 — recon (≤ 30 min, prepend to S1)

Confirm the §3 paths exist and record actuals. Machine-checkable:

```bash
cd minion_hub
test -f src/server/services/crm-contacts.service.ts
test -f src/routes/api/crm/contacts/+server.ts
test -f src/routes/\(app\)/crm/customers/+page.server.ts
test -f src/routes/\(app\)/crm/customers/+page.svelte
test -f src/lib/components/data-table/DataTable.svelte
rg -n 'contacts\s*[,:}]' src/routes/api/crm/contacts/+server.ts   # confirms response key
rg -l 'DataTable' src/routes | tee /tmp/datatable-consumers.txt    # expect ~11 files
rg -n 'pg_advisory_xact_lock|BEGIN|transaction' scripts/db-migrate.ts
rg -n "_funnel'" src/lib/crm/crm-funnel.ts   # enumerates the _funnel value domain S2's truth table must cover
```

---

### S1 — Paged query with total (`rankContactsPage`)

**Goal:** one round-trip returns a page of rows **and** the filtered total. No caller,
route or pixel changes.

**Do:**
- Add `count(*) over()::int as total_rows` to the outer `select` over the `scored` CTE.
  Strip `total_rows` from the returned rows.
- Export `interface RankedPage { rows: RankedContact[]; total: number }` and
  `rankContactsPage(ctx, f): Promise<RankedPage>`.
- Keep `rankContacts` as a thin wrapper returning `.rows` — existing callers (contact
  detail score, `/crm/cleanup`, dashboard via `listContactsCached`) are **untouched**.
- Extend the `sort` union with `'revenue'` and `'icp'`.
  `'icp'` orders by `(custom_fields->'_icp'->>'score')::numeric desc nulls last` — rows
  without `_icp` sort **last, never as 0**. This is the proposal's "ICP-fit column stays
  server-side" requirement; it is cheap, inert when no org has ICP data, and it is what
  makes `2026-08-03-crm-icp-score-spec` §8.1 composable instead of a rewrite.
- Extend `search` to also match `custom_fields->>'telefono'` and `->>'dni'` as
  **exact-prefix** (mirrors the gateway `crm_search` tool), keeping `display_name ILIKE`.

**Files:** `src/server/services/crm-contacts.service.ts`,
`src/server/services/crm-contacts.test.ts` (new cases).

**Definition of done (machine-checkable):**
```bash
bun run vitest run src/server/services/crm-contacts.test.ts   # green, incl. new cases:
#   - total equals the row count of the same filters with limit removed
#   - total is stable across offsets (page 1 total == page 5 total)
#   - sort:'icp' → nulls last (assert last id has no _icp)
#   - search matches a telefono prefix and a dni prefix, not a mid-string substring
bun run check                                                  # 0 errors / 0 warnings
rg -n 'export async function rankContacts\b' src/server/services/crm-contacts.service.ts
```
Plus an equivalence proof, run once and pasted into the PR: for the no-new-filters case,
`rankContacts` output before and after is identical (psql `except`-diff both directions on
the FACES dev org, per `831da4b0`'s review harness).

**Estimate:** 5–6 h (the `except`-diff harness is most of it).

---

### S2 — Server filters + funnel stage ported into SQL

**Goal:** every filter the client currently applies over the full roster becomes a SQL
predicate. This is the slice that actually makes a page of rows sufficient.

**Do:**
- Additive optional `RankFilters`: `awaitingReply?: boolean` → `awaiting_reply = true`;
  `buyerOnly?: boolean` ("reserved" toggle) → `is_buyer = true`. Both columns already exist
  in the `base` CTE.
- `funnelStage?: string` → port the client derivation (`crm-funnel.ts`:
  `effectiveFunnelStage` + `financeFloorStage`) into the `scored` CTE as a `funnel_stage`
  CASE over `custom_fields->>'_funnel'`, `inbound_msgs`, and the finance CTE's
  booked/purchased flags. Mirror the existing lifecycle-`stage` CASE precedent exactly.
- `minIcp`/`maxIcp` range filter, **inclusive at both endpoints** (`>= min AND <= max`) per
  the standing range-filter governance rule, so the ICP spec's §8.1 filter needs no server
  work later.

**Files:** `src/server/services/crm-contacts.service.ts`, `src/lib/crm/crm-funnel.ts`
(export the truth table / pure helpers if not already exported),
`src/server/services/crm-funnel-parity.test.ts` (new).

**Definition of done (machine-checkable):**
```bash
bun run vitest run src/server/services/crm-funnel-parity.test.ts
#   truth-table test: for every combination of (_funnel value × inbound>0 × booked × purchased),
#   the SQL CASE result == effectiveFunnelStage()/financeFloorStage() TS result. No skips.
#   The _funnel value domain is closed and finite — it is whatever Slice 0's
#   `rg "_funnel'" src/lib/crm/crm-funnel.ts` enumerates, not open-ended free text.
bun run vitest run src/server/services/crm-contacts.test.ts
#   awaitingReply / buyerOnly / minIcp / maxIcp each return the same contact_id SET as the
#   current client-side predicate applied to the full fixture roster (set equality, not order)
bun run check
```

**Estimate:** 7–8 h (the funnel parity table is the whole slice).

---

### S3 — API returns a page contract; per-page decoration

**Goal:** `GET /api/crm/contacts` is a complete server-mode data source. Still no UI change.

**Do:**
- Parse the S2 filters; return `{ contacts, total }` from `rankContactsPage`.
  **`contacts` keeps its name and element shape — additive only** (see alert A2).
- Default `limit` 100, max 500 (existing caps, unchanged).
- Decorate **only the returned page**: finance columns via the cached `contactFinanceMap(ctx)`,
  and `matchingAutoTagIds` evaluated over the ≤ 500 page rows instead of the roster.
- Meta (custom-field) column discovery: replace the full-roster `collectMetaKeys` scan with
  `select distinct jsonb_object_keys(custom_fields)` (cached `'10m'`), exported as
  `getMetaKeys(ctx)` from `crm-contacts.service.ts`. S3 only adds and tests the helper — S5
  is the slice that calls it from `+page.server.ts` and puts it on the page load. Keys are
  near-static.
- `fields=id` lean variant returning only ids for the current filters (feeds S6's
  "select all N matching"), capped at `ROSTER_CAP`.
- RBAC/masking unchanged: `shouldMaskSensitive` applies to page rows exactly as today; the
  `_icpClaim` / `_relationshipClaim` strip list is preserved.

**Files:** `src/routes/api/crm/contacts/+server.ts`,
`src/server/services/crm-contacts.service.ts` (meta-keys query),
`src/routes/api/crm/contacts/contacts.test.ts` (or the existing route test file).

**Definition of done (machine-checkable):**
```bash
bun run vitest run src/routes/api/crm/contacts    # incl.:
#   - response has both `contacts` (array) and `total` (int); `contacts` shape unchanged
#     vs a golden fixture captured before this slice
#   - limit>500 is clamped to 500; default is 100
#   - ?fields=id returns ids only, no PII fields present in any element
#   - masked principal: no masked field leaks; no key starting with '_' ending 'Claim'
rg -n 'export (async )?function getMetaKeys' src/server/services/crm-contacts.service.ts
bun run vitest run src/server/services/crm-contacts.test.ts
#   - getMetaKeys returns the distinct custom_fields keys on the fixture roster (set equality)
bun run check
curl -s "$HUB/api/crm/contacts?limit=100" -H "$AUTH" | wc -c    # < 300000 bytes
curl -s "$HUB/api/crm/contacts?limit=100" -H "$AUTH" | jq -e '.total|type=="number"'
```

**Estimate:** 6 h.

---

### S4 — DataTable opt-in server mode

**Goal:** `DataTable.svelte` gains a server mode. **Absent prop ⇒ byte-identical current
behavior** for all ~11 consumer routes. This is the highest-blast-radius slice; the entire
DoD is about proving nothing else moved.

**Do:** add one optional prop; when present, the table renders `rows` as-is (no client
filter/sort/slice), the pager reads `server.total`, and every interaction calls `onQuery`:

```ts
server?: {
  total: number;
  loading?: boolean;
  onQuery: (q: {
    search: string;
    sort: { key: string; dir: 'asc' | 'desc' } | null;
    filters: Record<string, string>;
    page: number; pageSize: number;
  }) => void;
}
```
Within-page interactions (column show/hide, row expand, selection) stay client-side.
Do **not** introduce TanStack Table, and do not fork the component.

**Files:** `src/lib/components/data-table/DataTable.svelte`,
`src/lib/components/data-table/DataTable.test.ts` (new server-mode cases).

**Definition of done (machine-checkable):**
```bash
bun run vitest run src/lib/components/data-table       # existing client-mode tests untouched & green
#   new: server mode does not re-sort/re-filter rows (feed unsorted rows, assert DOM order == input order)
#   new: pager label/pages derive from server.total, not rows.length
#   new: search/sort/page/filter changes each fire onQuery exactly once with the expected payload
git diff --name-only <sha-before-S4-commits>..HEAD -- '*.svelte' \
  | grep -v '^src/lib/components/data-table/' \
  && echo "FAIL: server mode must not require consumer edits" && exit 1
#   ⚠️ scope this to S4's own commit range, not `origin/master...HEAD` — per A4 the shared
#   branch may carry concurrent T2/U5 commits that legitimately touch other .svelte files;
#   diffing against origin/master would false-fail on their unrelated changes.
bun run check && bun run lint:tokens
DESIGN_LINT_BASE_REF=origin/master bun run lint:design    # explicit base ref is mandatory
```

⚠️ `lint:design` **silently exits 0** in a master-based worktree (its base defaults to the
deleted `origin/dev`). Always pass `DESIGN_LINT_BASE_REF`.

⚠️ Coordinate with `2026-07-06-hub-tanstack-consolidated-execution` T2 (row virtualization,
same file). If T2 has landed, build server mode on top of the virtualized `view`; if it is
in flight, whoever lands second rebases — do not land both blind.

**Estimate:** 6–8 h.

---

### S5 — Rewire `/crm/customers` to server mode

**Goal:** the proposal's headline. First page rendered server-side; every interaction is a
scoped fetch; the streamed full-roster path is **deleted**, not left dormant.

**Do:**
- `+page.server.ts`: return `{ page: rankContactsPage(ctx, filtersFromUrl), tags, total, metaKeys, financeEnabled }`.
  Remove the `streamed` roster entirely — a 100-row page serializes in milliseconds.
  Initial filters come from URL params (already URL-persisted today).
- `+page.svelte`: a small `$state` request manager wired to `server.onQuery` →
  `fetch('/api/crm/contacts?…')` with 300 ms debounce on search, a promise-identity guard
  (pattern already in this file from `1e1804c1`), and URL param sync.
  `invalidate('crm:contacts')` after mutations refetches the **current page**.
- Bulk actions and the merge resolver operate on selected ids; the resolver fetches full
  rows for selected ids only.

**Files:** `src/routes/(app)/crm/customers/+page.server.ts`,
`src/routes/(app)/crm/customers/+page.svelte`, plus the CRM components those two own.

**Definition of done (machine-checkable):**
```bash
rg -n 'streamed' src/routes/\(app\)/crm/customers/+page.server.ts    # zero matches
rg -n 'listContactsCached' src/routes/\(app\)/crm/customers/          # zero matches
bun run check && bun run lint:tokens
DESIGN_LINT_BASE_REF=origin/master bun run lint:design
bun run vitest run src/routes/\(app\)/crm
# browser probe (recipe: memory `hub-ui-browser-testing`, harness: browser-harness skill):
#   - document + data payload for the default view < 300 KB total
#   - ≥ 20 rendered rows within 2 s warm
#   - typing in search updates rows in < 1 s; URL reflects state; reload restores it
```

**Estimate:** 8 h.

---

### S6 — Pagination-safe feature relocations + cleanup

**Goal:** close the two features that silently break under pagination, then remove the dead
full-roster paths. Without this slice the page is fast and quietly wrong.

**Do:**
- `GET /api/crm/contacts/export.csv` — streams CSV from `rankContacts` with the **same
  filters** as the current view, `maxLimit: ROSTER_CAP`, gated on `canAct('crm','export')`,
  PII-masked per `shouldMaskSensitive`. DataTable's export button calls it when in server
  mode (client export would otherwise emit one page and look like a complete export).
- Bulk selection: "select all on this page" (exact) + "select all N matching" via
  `?fields=id` from S3.
- Delete the page's `matchingAutoTagIds` full-roster path; confirm the only remaining
  `listContactsCached` consumers are the `/crm` dashboard, `/crm/cleanup` and contact detail.
- Route-contract counts updated (the export endpoint is a new `+server.ts`).

**Files:** `src/routes/api/crm/contacts/export.csv/+server.ts` (new),
`src/lib/components/data-table/DataTable.svelte` (export button branch),
`src/routes/(app)/crm/customers/+page.svelte`, route-contract fixture/test.

**Definition of done (machine-checkable):**
```bash
bun run vitest run src/routes/api/crm/contacts     # incl.:
#   - export without crm:export → 403
#   - export with filters returns the FULL filtered set (row count == /api/crm/contacts total),
#     not one page
#   - masked principal's CSV contains no unmasked sensitive column
bun run vitest run route-contract                  # counts updated for the new +server.ts
rg -n 'listContactsCached' src/routes/\(app\)/crm/customers/    # zero matches
bun run check
```

**Estimate:** 6–7 h.

---

## 3. Files touched (consolidated)

| File | Slices | Nature |
|---|---|---|
| `src/server/services/crm-contacts.service.ts` | S1, S2, S3 | paged query, total, filters, funnel CASE, meta keys |
| `src/server/services/crm-contacts.test.ts` | S1, S2 | new cases |
| `src/server/services/crm-funnel-parity.test.ts` | S2 | new |
| `src/lib/crm/crm-funnel.ts` | S2 | export pure helpers for the parity test |
| `src/routes/api/crm/contacts/+server.ts` | S3 | `{ contacts, total }`, page decoration, `fields=id` |
| `src/routes/api/crm/contacts/export.csv/+server.ts` | S6 | new endpoint |
| `src/lib/components/data-table/DataTable.svelte` | S4, S6 | opt-in `server` prop, export branch |
| `src/lib/components/data-table/DataTable.test.ts` | S4 | new |
| `src/routes/(app)/crm/customers/+page.server.ts` | S5 | first page, drop streamed roster |
| `src/routes/(app)/crm/customers/+page.svelte` | S5, S6 | request manager, URL sync, bulk select |
| `supabase/migrations/<ts>_crm_contacts_search_indexes.sql` | S1 | additive indexes only (see A1) |

All paths relative to `minion_hub/`. Nothing outside `minion_hub/` is edited — see §5.

## 4. Migration (additive, indexes only — no schema change)

The proposal puts schema changes out of scope. Indexes are not schema changes in that sense
(no table/column/type touched), but they are DDL and must ship through the pipeline.

```sql
-- supabase/migrations/<YYYYMMDDHHMMSS>_crm_contacts_search_indexes.sql
create extension if not exists pg_trgm;
create index if not exists crm_contacts_display_name_trgm
  on crm_contacts using gin (lower(display_name) gin_trgm_ops);
create index if not exists crm_contacts_org_deleted_idx
  on crm_contacts (org_id) where deleted_at is null;
```

Verify with `bun run db:status` (shows PENDING), then it applies on the Vercel **production**
build via `db:migrate`. Never `drizzle-kit push`. Rollback = compensating migration.

## 5. Cross-repo impact

Per AGENTS.md "Cross-Project Impact Zones", the two zones this work could touch are
**DB schema change** (hub → site, shared DB) and **gateway protocol** (shared → hub/site/paperclip).
Assessment:

| Surface | Impact | Mitigation |
|---|---|---|
| `minion_site` (shares the DB with hub) | **None.** Index-only DDL; no table, column or type changes | CI guard: `git diff --name-only origin/master...HEAD \| grep -qE '^(packages/db\|src/server/db/schema)/' && exit 1` |
| `@minion-stack/db` (canonical Drizzle schema) | **None** — no schema edit, so no version bump, no changeset, no site-side sync | same guard as above |
| `@minion-stack/shared` / gateway WS protocol | **None** — this is REST + SSR only, no frame types touched | — |
| `packages/crm-sdk` | **None** — verified in this checkout: `client.ts` talks to Postgres directly (`update crm_contacts …`) and never calls `/api/crm/contacts` | grep in Slice 0 re-confirms |
| `paperclip-minion`, `pixel-agents`, `minion_plugins` | **None** | — |
| `minion/` gateway CRM tools | **Unknown until checked** — alert A2 | see A2 |

### 🚨 A1 — `create index concurrently` will fail in hub's migration runner

`2026-07-07-hub-db-migration-pipeline` states each migration file applies **inside one
transaction** under `pg_advisory_xact_lock`. Postgres rejects `CREATE INDEX CONCURRENTLY`
inside a transaction block. The 2026-08-03 design specifies `concurrently`; **that would
abort the production deploy**, which is exactly the failure mode the pipeline was built to
prevent (code never ships ahead of schema — the deploy just dies).

Mitigation, in order of preference:
1. Ship the indexes **non-concurrently** (as written in §4). At ~15–17 k rows a plain
   `create index` on `crm_contacts` locks writes for well under a second. This is the
   default; take it unless the row count has grown by an order of magnitude.
2. If a lock is unacceptable: apply the concurrent index out-of-band via psql, then land a
   no-op migration file whose version is inserted into `hub_migrations` so the ledger stays
   truthful. Document the manual step in the PR.

Slice 0 verifies the transaction claim before either path is chosen.

### 🚨 A2 — response-shape compatibility of `/api/crm/contacts`

This spec assumes `{ contacts }` already exists and `total` is purely additive. Before S3
merges, run across every checked-out sibling repo:

```bash
rg -n '/api/crm/contacts' ~/work/minion ~/work/minion_hub ~/work/minion_site \
   ~/work/paperclip-minion ~/work/packages
```
- If every consumer reads `.contacts` → additive, no impact, proceed.
- If any consumer (notably a gateway `crm_search` tool) consumes a **bare array**, do not
  change the shape: add `total` via a response header or a sibling `?meta=1` request, and
  raise it in the PR description. **Never rename or re-nest `contacts`.**

### ⚠️ A3 — `DataTable.svelte` is shared by ~11 routes

Adding a mode to a component eleven pages depend on is the real risk in this spec, not the
SQL. S4's DoD is written so that any consumer-visible change fails the slice: client-mode
tests must pass untouched, and no other `.svelte` file may appear in the diff.

### ⚠️ A4 — concurrent branch contention

`DataTable.svelte` is also the target of `2026-07-06-hub-tanstack-consolidated-execution` T2,
and `/crm/customers` is also the target of `2026-08-03-crm-icp-score-spec` U5. Branch off the
LIVE shared branch, scope commits to your own files, never `git add -A`, and check for
in-flight work on both files before starting S4/S5.

## 6. Out of scope (explicit)

- **Any other CRM route** — `/crm` dashboard, `/crm/cleanup`, contact detail. They read
  `listContactsCached` server-side and are deliberately untouched.
- **Any other DataTable consumer route.** Server mode is opt-in; migrating the other ten
  consumers is separate work.
- **Schema changes** — no new tables, columns or types. Indexes only (§4).
- **The ICP feature itself.** This spec ships the server-side `sort:'icp'` and
  `minIcp`/`maxIcp` hooks so the column composes; the column UI, scoring pipeline and
  settings editor belong to `2026-08-03-crm-icp-score-spec`.
- **New search infrastructure.** Meilisearch/Typesense/ES were evaluated and rejected at
  this scale (2026-08-03 §6); revisit at ≥ 500 k contacts.
- **TanStack Query adoption.** The single-page request manager is ~30 lines; the standing
  "Query NARROW" decision holds.
- **Row virtualization.** Owned by the TanStack consolidated-execution spec (T2). If jank
  shows at 100–500 rows/page, file it there — do not fold it in here.
- **Valkey relocation, `/finances` aggregates, `knowledge_chunks` stats** and the other
  levers in 2026-08-03 §7.
- **Perf work against production.** All measurement is dev-warm, FACES org.

## 7. Relationship to `2026-08-03-crm-customers-server-pagination-spec`

That spec remains the **design of record** — read it in full before S1; this document does
not restate its measurements, its per-field byte attribution, or its third-party evaluation.
This spec supplies the slicing, the machine-checkable DoDs, the cross-repo assessment and
two corrections (A1 `concurrently`; ICP sort promoted into S1 so it is not retrofitted).

Its `status: draft` / stage should be reconciled once this spec is approved — a human call,
and deliberately not made here: this spec touches no other file.

## 8. End-to-end verification

Run on the LIVE shared branch with all six slices merged, dev server warm, FACES dev org
(~15.5 k contacts). Do **not** run `bun run check` while measuring — svelte-kit sync reload
loops wipe the in-process cache (measured 47 s "warm" artifacts).

```bash
cd minion_hub

# 1. Gates
bun run check                                    # 0 errors / 0 warnings
bun run vitest run                               # full suite green
bun run lint:tokens
DESIGN_LINT_BASE_REF=origin/master bun run lint:design
bun run db:status                                # index migration applied or PENDING as expected

# 2. Payload — the proposal's "initial payload ≤ 1 page of rows"
curl -s "$HUB/crm/customers" -H "$AUTH" | wc -c                       # < 300000
curl -s "$HUB/api/crm/contacts?limit=100" -H "$AUTH" | jq '.contacts|length'   # == 100
curl -s "$HUB/api/crm/contacts?limit=100" -H "$AUTH" | jq '.total'            # ~15500, not 100

# 3. Row-set equivalence vs today's client-side behavior (fixture org)
#    For each of: default, search, stage, funnel, tag, channel, score range,
#    awaiting, reserved, and each sortable column — the server page-1 contact_id
#    set/order equals the first N of the legacy client-side result.
bun run vitest run src/server/services/crm-contacts.parity.test.ts

# 4. Export is not one page
curl -s "$HUB/api/crm/contacts/export.csv?stage=lead" -H "$AUTH" | tail -n +2 | wc -l
curl -s "$HUB/api/crm/contacts?stage=lead&limit=1" -H "$AUTH" | jq '.total'   # must match

# 5. Browser probe (browser-harness skill; recipe in memory `hub-ui-browser-testing`)
#    - navigate to /crm/customers warm → ≥ 20 rendered rows within 2 s
#    - type "mar" in search → rows update < 1 s; URL contains the search param
#    - reload → filter state restored
#    - sort the ICP column → network request carries sort=icp; no client re-sort
#    - page 2 → one request, 100 rows, no full-roster fetch in the network log
```

**Ship gate:** all of §8 green, plus the 2026-08-03 acceptance criteria (§4 there) checked
off item by item in the PR description, plus A2's consumer grep pasted into the PR.
