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

The spec and its proposal are authored in minion-meta, which is **not checked out in this
workspace** (this branch may only touch `minion_hub`). The runtime evidence below was
produced here, so it is recorded here; the minion-meta proposal's "Open items" section
still owes the same amendment — see [Owed to minion-meta](#owed-to-minion-meta).

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
- The unit suites still exercise 0.10 / 0.08 / 0.05 as **pure arithmetic fixtures** for the
  rounding formula (so a future vigente rate is safe to add). They assert against
  `SUNAT_VIGENTE_IGV_RATES` that those fixtures are not rates the product will emit.

## Owed to minion-meta

1. Amend `proposals/2026-08-17-hub-igv-rate-from-org-config.md`: its open item still reads
   "no beta cert; make 10% pass". That is disproved — replace it with the matrix above and
   the fail-closed decision. `scripts/gen-beta-cert.sh` + live egress to
   `e-beta.sunat.gob.pe` are all the harness needs; nothing is blocked on a certificate.
2. Correct §6 step 3 of the spec: the 10% acceptance criterion cannot be met and must not
   be re-attempted as written.

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
- **Settings form copy.** `/finances/settings` still shows the generic save-failure message
  when the rate is refused; the API returns the specific reason
  (`IGV_RATE_NOT_VIGENTE_MESSAGE`) but the form does not surface it. Localised copy for
  that case is unwritten.
