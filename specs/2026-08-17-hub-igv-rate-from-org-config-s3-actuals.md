---
id: 2026-08-17-hub-igv-rate-from-org-config-s3-actuals
title: 'S3 actuals — the configurable IGV rate is bounded by SUNAT, not by us'
stage: spec
status: in-progress
created: 2026-08-29
spec: 2026-08-17-hub-igv-rate-from-org-config-spec
proposal: 2026-08-17-hub-igv-rate-from-org-config
repos: [minion_hub]
tags: [finance, emission, sunat]
type: fix
---

# S3 actuals — `2026-08-17-hub-igv-rate-from-org-config-spec`

The spec and its proposal are authored in minion-meta. The runtime evidence below was
produced here and is recorded here; it has also been carried into minion-meta itself — see
[Recorded in minion-meta](#recorded-in-minion-meta).

## The result S3 was supposed to confirm, disproved

§6 step 3 asked for a live beta run at `--rate 0.18` **and** `--rate 0.10`, expecting both
to come back `ResponseCode 0`. Half of that is impossible: SUNAT's `sendBill` validator
rejects a document whose IGV is not a rate currently in force.

### Live run — SUNAT beta (`e-beta.sunat.gob.pe`), 2026-08-29

Cert: `bash scripts/gen-beta-cert.sh` (self-signed; beta needs no registered certificate).
Auth: the public documentation pair `20611172967MODDATOS` / `MODDATOS`.

| Command                                        | Document                                    | Result                                                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun scripts/emit-beta-test.ts`                | boleta B999-1                               | **`ResponseCode 0`** — "La Boleta numero B999-1, ha sido aceptada"                                                                                        |
| `bun scripts/emit-beta-test.ts`                | factura F999-1                              | **`ResponseCode 0`** — "La Factura numero F999-1, ha sido aceptada"                                                                                       |
| `bun scripts/emit-beta-test.ts --rate 0.10`    | boleta B999-1                               | **fault `soap-env:Client.3462`** — "La tasa del IGV debe ser la misma en todas las líneas o ítems del documento y debe corresponder con una tasa vigente" |
| `bun scripts/emit-beta-test.ts --rate 0.10`    | factura F999-1                              | **fault `soap-env:Client.3462`** (same)                                                                                                                   |
| `bun scripts/summary-beta-test.ts --rate 0.10` | B998-1, B998-2, F998-1 via `sendBill`       | **fault `soap-env:Client.3462`** for all three                                                                                                            |
| `bun scripts/summary-beta-test.ts --rate 0.10` | RC-20260829-1, RC-20260829-2, RA-20260829-1 | **`ResponseCode 0`, and that acceptance is meaningless** — see below                                                                                      |

### The resumen trap

`submitResumen` / `submitBaja` do **not** re-validate the rate of the boleta/factura they
reference. In the 10% run every referenced document had already been rejected by
`sendBill`, and SUNAT still accepted both resúmenes and the baja with `ResponseCode 0`. A
green resumen is therefore **not** evidence that the underlying documents were accepted —
do not use `summary-beta-test.ts` alone to sign off a rate.

## What shipped instead (S3, this branch)

Fail closed on a shared allowlist, `src/lib/finance/igv-rates.ts`:

- `SUNAT_VIGENTE_IGV_RATES = [0.18]` — the only rate this run proved `sendBill` accepts.
- **Settings-write boundary** — `PUT /api/finances/settings` (zod `.refine(isVigenteIgvRate)`, 400) and `updateFinSettings` (throws). An admin can no longer persist a rate that would
  break every later emission for the org.
- **Emission boundary** — `resolveIgvRate` (`src/server/finance/tax.ts`) throws
  `PosError('invalid_tax_rate')`. This is not a duplicate of the gate above: a row written
  before the gate existed, or edited straight in the database, is refused here and recorded
  as a `status=error` emission row instead of reaching SUNAT.
- The rate stays a threaded **input** (`EmissionInvoice.igvRate`) all the way to the XML —
  no module-level constant returns. `src/server/finance/emission/no-hardcoded-rate.test.ts`
  is the permanent guard, and it now discovers every production `EmissionInvoice`
  construction site under `src/` so a new one cannot be added outside its scan.
- **Settings form** — `/finances/settings` offers the allowlist as a `Select` instead of a
  free percent field, so an invalid rate cannot be typed in the first place. A rate
  persisted before the gate existed still renders, labelled `— not accepted by SUNAT`
  (`fin_money_tax_unsupported`), so an admin sees and can correct it rather than having it
  silently vanish from the form. Ported from PR #159, which owned this half of S3.
- The unit suites still exercise 0.10 / 0.08 / 0.05 as **pure arithmetic fixtures** for the
  rounding formula (so a future vigente rate is safe to add). They assert against
  `SUNAT_VIGENTE_IGV_RATES` that those fixtures are not rates the product will emit.

## Recorded in minion-meta

`proposals/2026-08-17-hub-igv-rate-from-org-config.md` (dev `80899b4`) and
`specs/2026-08-17-hub-igv-rate-from-org-config-spec.md` (dev `af15a66`) have been amended to
carry the matrix above, the fail-closed decision, and the reduced-rate / exonerada-inafecta /
persisted-invalid-rate follow-ups. §6 step 3 of the spec no longer asks for a `ResponseCode 0`
at 10% — it now states the expected fault and warns that a resumen/baja acceptance is not
proof a referenced document's rate was accepted.

## Open items (not implemented, deliberately)

- **Reduced-rate regimes.** Peru has had eligibility-gated, time-bounded reduced IGV rates
  (MYPE restaurant / hotel / tourist accommodation). Adding one is not "append a number to
  the allowlist": `fin_settings` holds a single scalar with no regime or eligibility column,
  and the entry would then be offered to every org. Needs its own spec.
- **Exonerada / inafecta operations.** An org that legitimately operates exonerada or
  inafecta now gets `invalid_tax_rate` on every ticket — honest, but not a feature. SUNAT
  models those with different affectation codes (catalog 07 codes 20/30, tax schemes
  9997/9998) and separate `LegalMonetaryTotal` buckets, all of which are out of scope of
  the spec's §5 (one gravada rate per document). Needs per-line affectation type, the
  exempt/unaffected totals, and a settings surface to declare the operation type.
  Code pointer: `TODO(handoff)` in `src/server/finance/tax.ts`.
- **Bulk correction of already-persisted rates.** Nothing sweeps `fin_settings` for rows
  written before the gate existed. Such an org keeps rendering its stored rate (flagged in
  the form) and fails closed at emission until an admin re-saves; no migration or report
  identifies those orgs proactively.
