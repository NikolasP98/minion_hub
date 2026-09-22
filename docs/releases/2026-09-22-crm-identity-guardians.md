---
id: 2026-09-21-hub-customer-identity-guardians-spec
title: POS customer identity and legal guardians
stage: dev
status: implemented
verdict: partial
created: 2026-09-21
updated: 2026-09-21
repos: [minion_hub]
proposal: 2026-09-21-hub-customer-identity-guardians
tags: [crm, pos, data, security]
---

# POS customer identity and legal guardians

## AS-IS

- `src/lib/components/pos/CustomerQuickAdd.svelte`: document-led limited registration.
- `src/routes/api/crm/parties/+server.ts`: create contract lacks DOB and sex; document shape can imply RUC/DNI.
- `src/server/db/pg-party-schema.ts`: shared party identity contains DOB, verification flag and registry metadata.
- `src/routes/(app)/crm/[contactId]/+page.svelte`: fixed fields include name, document, phone, email, DOB, sex, district, reason and referral; DOB is read-only and displayed as ISO.
- `src/server/services/party.service.ts`: verified reenrichment omits partially enriched records and its shared enrichment helper overwrites names.

## TO-BE and invariants

1. Quick-add supports manual entry for all existing editable customer fields. DNI lookup is optional and limited to explicit Peruvian DNI identities. Foreign document types preserve their text and never trigger a registry based solely on length. New data persists on canonical party/contact fields and is returned by CRM.
2. A customer can link multiple adult CRM contacts as guardians. The server rejects self-links, foreign-tenant links, non-persons, missing/invalid DOB and under-18 guardians. Repeated linking is harmless. Removing one link does not delete either identity. UI and API retain CRM capability checks.
3. DOB is a date-only value, editable through a date picker. Invalid/future dates fail validation. The visible display uses localized abbreviated month with two-digit day and four-digit year; timezone conversion cannot move the birthday.
4. The live repair audits all verified persons and separately accounts for verified companies, whose DOB/sex are inapplicable. Fill only missing name, DOB and sex with supported evidence; never infer sex or DOB. Preserve nonempty fields and concurrent changes. Record aggregate coverage and private recovery evidence. Re-running after success performs no further writes.

## DELTA and proof

- Expand quick-add and API/service persistence; tests cover manual/foreign/DNI/RUC paths and stale lookup responses.
- Add tenant-scoped guardian persistence, migration and QA seed pairing; tests cover isolation, age boundaries, self-link, missing DOB, duplicate add and removal.
- Replace read-only DOB editing and ISO display; test leap days, future dates and localized date-only formatting; exercise actual browser save/reload.
- Add a reproducible bounded backfill with authoritative cache/provider reuse, guarded updates and aggregate before/after audit. Report unavailable evidence rather than fabricating completion.
- Run focused tests, Svelte checks, design/token gates and local QA runtime paths. Do not use production for feature testing.

## Review and release

The user's request supplies implementation and live repair approval. Two-pass review (standards, then requirement/security behavior) is recorded alongside validation before completion. Human merge and feature deployment remain separate. Existing unrelated dirty files must be preserved; no automatic branch switch, worktree creation, commit or merge.

## Validation evidence

The Sol implementation agents and independent reviewer completed the implementation review. The final `bun run check` reports **0 errors and 0 warnings**. Design lint with `--ci --base-ref HEAD` passes; token integrity reports zero violations. Using `HEAD` matters because this checkout has no `origin/dev` reference and the default design command skips its changed-file comparison.

Focused quick-add/API tests, CRM detail loader tests, resolver permission tests, manual-sex projection regression and repair-script tests pass. `crm-guardians.integration.test.ts` passed against loopback QA PostgreSQL, proving the exact-18 boundary, missing/underage/company/foreign-organization rejection, replay safety, removal and the prohibition on making an existing guardian underage.

Actual HTTP QA evidence is saved privately at `minion_hub/data/qa/crm-identity-guardians-http-smoke-2026-09-21.json`: login 200; foreign adult/minor creation 201 with distinct parties despite the same phone; passport/DOB/sex/nationality readback 200; DOB edit 200; invalid date 400; guardian add 201, list 200, self/underage rejection 422, and removal 200. Both synthetic contacts and parties were removed afterward. The guardian migration is applied only to local QA; this is not production deployment evidence.

The full QA seed run encountered an unrelated existing `crm_tags` conflict-target mismatch; the focused migration, database tests and HTTP workflows above ran successfully. Existing unrelated work remains unstaged and unchanged by this task except for additive edits in shared files.

Production coverage: **2,113 verified identities = 2,108 people + 5 companies**. All verified people have names and sex populated; seven lack DOB. Fourteen configured provider calls returned no usable birthday for those seven, and a cached rerun made no new calls. **Zero production updates** were made. The guarded script and proposal ledger record the missing authoritative source; exact birthdays are never inferred from age. Independent standards and requirement review is recorded in the matching minion-meta spec review.

Browser evidence: POS quick-add exposed all standard fields; a synthetic foreign minor with an eleven-digit passport, leap-day DOB, sex, email, address, nationality, occupation, district, reason and referral was saved and selected. DNI autofill remained hidden for the passport. The Legal guardians link resolved the new CRM contact, whose details showed `29 Feb 2012` and the entered fields. The native DOB input held `2012-02-29` with a local-date maximum. Screenshots are retained under ignored `minion_hub/data/qa/crm-identity-ui/`.

The browser found a guardian-card overlap missed by API tests: putting two cards in the details grid cell caused the second card to be covered by Connections. Guardians now has its own `EditableGrid` item and renderer. Existing saved layouts gain the new item through `mergeLayout`; its tests and CRM loader tests pass (6/6). This fix did not change unrelated layout preferences.

After the layout fix, browser QA opened the native DOB picker, saved a change to `01 Mar 2012`, linked the seeded adult contact, and performed a full reload in Spanish. The persisted date displayed as `01 mar. 2012` and the guardian remained linked. The final Svelte check after the layout change again reported zero errors and warnings.

The synthetic browser contact, its party and guardian relation were removed from loopback QA after verification; each remaining count is zero. The seeded adult contact remains present. The isolated local test browser was stopped.

## Release qualification

Release preparation isolates this feature from shared-checkout WIP and integrates it onto `e9e09685` (current `origin/master` at preparation). The user authorized verification and deployment on 2026-09-22. Migration application uses the normal Vercel production build gate; no manual production migration was run. The guarded metadata repair remains a separate operational script and never runs during deployment.

The release review corrected guardian removal to use the edit-gated POST action, matching the permission required to link a guardian. Existing DELETE compatibility is retained.

The read-only production catalog preflight confirmed compatible UUID contact/party keys, text organization keys, date DOB storage, the existing app_ledger role and grants, and no existing guardian table/function/trigger collisions. Independent final source review passed after adding explicit CRM-view enforcement on guardian reads and live-contact/owner filters on the POS resolver.
