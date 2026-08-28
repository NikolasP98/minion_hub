#!/usr/bin/env bun
/**
 * Manual live-beta smoke test for the resumen/baja slice — run with
 * `bun scripts/summary-beta-test.ts` after `scripts/gen-beta-cert.sh`.
 * Not a vitest file — SUNAT's beta endpoint is a live network dependency,
 * this is deliberately manual (same pattern as emit-beta-test.ts).
 *
 * Steps (DoD from specs/2026-08-14-sunat-resumen-baja-spec.md):
 * 1. Emit two boletas B998-1, B998-2.
 * 2. submitResumen RC with both (estado 1) -> CDR ResponseCode 0.
 * 3. submitResumen RC with B998-2 estado 3 (anulacion) -> accepted.
 * 4. Emit factura F998-1, then submitBaja RA for it -> accepted.
 *
 * LIVE-BETA RESULTS, S3 of specs/2026-08-17-hub-igv-rate-from-org-config-spec.md
 * (cert from `bash scripts/gen-beta-cert.sh` — beta accepts a self-signed one;
 * this environment reaches e-beta.sunat.gob.pe directly).
 *
 * Supported regime (18%) — the acceptance matrix S3 requires, ALL CDRs
 * ResponseCode 0, re-run 2026-08-28:
 *   - `bun scripts/emit-beta-test.ts`
 *       B999-1 "La Boleta numero B999-1, ha sido aceptada"
 *       F999-1 "La Factura numero F999-1, ha sido aceptada"
 *   - `bun scripts/summary-beta-test.ts`
 *       B998-1 / B998-2 "...ha sido aceptada"
 *       RC-20260828-1 (both estado 1) "El Resumen diario ... ha sido aceptado"
 *       RC-20260828-2 (B998-2 estado 3, anulacion) "... ha sido aceptado"
 *       F998-1 "La Factura numero F998-1, ha sido aceptada"
 *       RA-20260828-1 "La Comunicacion de baja ... ha sido aceptada"
 *
 * Unsupported rate (10%) — the experiment that motivated the fail-closed gate:
 *   - `bun scripts/emit-beta-test.ts --rate 0.10`: BOTH documents REJECTED,
 *     SUNAT fault soap-env:Client.3462 "La tasa del IGV debe ser la misma en
 *     todas las lineas o items del documento y debe corresponder con una tasa
 *     vigente." Not a UBL/arithmetic bug on our side — `sendBill` validates the
 *     declared rate against the rates in force for the emitter.
 *   - `bun scripts/summary-beta-test.ts --rate 0.10`: B998-1/B998-2/F998-1 fail
 *     the same 3462 fault on their `emitToBeta` calls. RC-1/RC-2/RA-1 did return
 *     ResponseCode 0 at 10%, but only because those validators do not re-check
 *     the underlying document's tax rate the way `sendBill` does — the
 *     referenced documents were never accepted, so that is not evidence the
 *     configurable-rate path works.
 *
 * SCOPE OF THAT EVIDENCE — deliberately not generalized: 10% is not a rate in
 * force for this emitter, so the run proves exactly that (rejected), plus that
 * 18% is accepted. It does NOT establish anything about Peru's reduced-rate
 * MYPE restaurant/hotel/tourist-accommodation regime, whose applicable rate is
 * a different number, is eligibility-gated per taxpayer and is time-bounded.
 *
 * FIXED (this branch): `resolveIgvRate` (src/server/finance/tax.ts) and the
 * settings write boundary (`updateFinSettings`, `PUT /api/finances/settings`,
 * the finance settings form) now share one allowlist —
 * `$lib/finance/igv-rates` — so a rate SUNAT would reject with 3462 is refused
 * at configuration time and again before emission, instead of being persisted
 * and breaking every later submission for that org.
 *
 * TODO(handoff): supporting the reduced-rate regime is still open, and is not
 * "add a number to SUNAT_VIGENTE_IGV_RATES" — `fin_settings` stores one scalar
 * with no regime/eligibility column. Scoping it needs minion-meta
 * `proposals/2026-08-17-hub-igv-rate-from-org-config.md` amended with these
 * results and the fail-closed decision; this run's harness contract is
 * Hub-repo-only, so that cross-repo edit could not be made here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  emitToBeta,
  submitBaja,
  submitResumen,
  type EmissionInvoice,
} from '../src/server/finance/emission/index.ts';
import { rateArg } from './_rate-arg.ts';

const certDir = join(import.meta.dirname, '..', '.beta-cert');
const certPem = readFileSync(join(certDir, 'cert.pem'), 'utf8');
const keyPem = readFileSync(join(certDir, 'key.pem'), 'utf8');

const today = new Date().toISOString().slice(0, 10);
const emitter = { ruc: '20611172967', razonSocial: 'FACES BETA SAC' };
// Synthetic payloads with no org behind them, so the rate is explicit here —
// `--rate 0.10` puts a non-statutory resumen in front of SUNAT's real
// validator without editing this file. boleta2/factura spread boleta1, so
// setting it once covers every document this harness sends.
const igvRate = rateArg();

const boleta1: EmissionInvoice = {
  docType: '03',
  serie: 'B998',
  correlativo: '1',
  issueDate: today,
  currency: 'PEN',
  igvRate,
  emitter: { ...emitter, ubigeo: '150101', address: 'AV BETA 123, LIMA' },
  client: { docType: '1', docNumber: '12345678', name: 'CLIENTE DE PRUEBA UNO' },
  lines: [{ description: 'Servicio de prueba resumen 1', quantity: 1, unitPriceInclTax: 118 }],
};

const boleta2: EmissionInvoice = {
  ...boleta1,
  correlativo: '2',
  client: { docType: '1', docNumber: '87654321', name: 'CLIENTE DE PRUEBA DOS' },
  lines: [{ description: 'Servicio de prueba resumen 2', quantity: 1, unitPriceInclTax: 59.9 }],
};

const factura: EmissionInvoice = {
  ...boleta1,
  docType: '01',
  serie: 'F998',
  correlativo: '1',
  client: { docType: '6', docNumber: '20611172967', name: 'EMPRESA DE PRUEBA SAC' },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function step(label: string, fn: () => Promise<unknown>) {
  console.log(`\n--- ${label} ---`);
  try {
    const result = await fn();
    console.log(result);
  } catch (e) {
    console.error(e);
  }
  await sleep(3000); // beta gateway rate-limits back-to-back requests
}

console.log(`=== resumen/baja live-beta run at IGV ${igvRate * 100}% ===`);

await step('emit boleta B998-1', () => emitToBeta(boleta1, certPem, keyPem));
await step('emit boleta B998-2', () => emitToBeta(boleta2, certPem, keyPem));

await step('submitResumen RC-1: B998-1 + B998-2, both estado 1', () =>
  submitResumen(
    {
      emitter,
      correlativo: '1',
      referenceDate: today,
      issueDate: today,
      lines: [
        { invoice: boleta1, estado: '1' },
        { invoice: boleta2, estado: '1' },
      ],
    },
    certPem,
    keyPem,
  ),
);

await step('submitResumen RC-2: B998-2 estado 3 (anulacion)', () =>
  submitResumen(
    {
      emitter,
      correlativo: '2',
      referenceDate: today,
      issueDate: today,
      lines: [{ invoice: boleta2, estado: '3' }],
    },
    certPem,
    keyPem,
  ),
);

await step('emit factura F998-1', () => emitToBeta(factura, certPem, keyPem));

await step('submitBaja RA-1: F998-1', () =>
  submitBaja(
    {
      emitter,
      correlativo: '1',
      referenceDate: today,
      issueDate: today,
      lines: [
        { docType: '01', serie: 'F998', correlativo: '1', motivo: 'ERROR EN EL COMPROBANTE' },
      ],
    },
    certPem,
    keyPem,
  ),
);
