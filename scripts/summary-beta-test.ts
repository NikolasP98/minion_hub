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
 * TODO(handoff): S3 of 2026-08-17-hub-igv-rate-from-org-config-spec.md
 * requires running this (and emit-beta-test.ts) at --rate 0.10 against
 * SUNAT's live beta validator and recording the CDR ResponseCode/description.
 *
 * DONE 2026-08-28 (an earlier note here said no cert was available — wrong;
 * `bash scripts/gen-beta-cert.sh` makes a self-signed cert, which is all beta
 * needs, and this environment has live network access to e-beta.sunat.gob.pe):
 *   - `bun scripts/emit-beta-test.ts` (18%, baseline): boleta B999-1 and
 *     factura F999-1 both ResponseCode 0 ("...ha sido aceptada").
 *   - `bun scripts/emit-beta-test.ts --rate 0.10`: BOTH documents REJECTED —
 *     SUNAT fault soap-env:Client.3462: "La tasa del IGV debe ser la misma en
 *     todas las líneas o ítems del documento y debe corresponder con una tasa
 *     vigente." (the rate must match a currently-in-force IGV rate). Not a
 *     UBL/arithmetic bug on our side — SUNAT's live `sendBill` validator hard
 *     -rejects any igvRate other than the statutory 18% at the document level.
 *   - `bun scripts/summary-beta-test.ts --rate 0.10`: boletas B998-1/B998-2
 *     and factura F998-1 fail the same 3462 fault on their `emitToBeta` calls
 *     (this script's own convention of sending the doc via sendBill before
 *     summarizing/voiding it, not the production boleta path). `submitResumen`
 *     (RC-1/RC-2) and `submitBaja` (RA-1) themselves DID return ResponseCode 0
 *     at 10% — but only because those validators don't re-check the
 *     underlying document's tax rate the way `sendBill` does; the referenced
 *     boletas/factura were never actually accepted into SUNAT in the first
 *     place, so that's not evidence the configurable-rate path works.
 *
 * NET: `resolveIgvRate` (src/server/finance/tax.ts, shipped in #133, already
 * on master) lets an org configure any rate in (0,1) and feeds it straight to
 * `EmissionInvoice.igvRate` for real `sendBill` submission. Live SUNAT beta
 * now proves that for any org configuring a rate other than 0.18, every
 * factura and every individually-`sendBill`'d boleta is rejected outright
 * (fault 3462) — a production-breaking gap in the already-shipped feature,
 * not just a missing test. Needs a minion-meta proposal amendment (open-items
 * section, mirroring this spec's own S3 append) to decide the mitigation
 * (e.g. reject/warn on a non-vigente configured rate before it ever reaches
 * emission) — designing that is out of scope here. This run's harness
 * contract is Hub-repo-only (no minion-meta write access), so the proposal
 * itself could not be amended from this pass either.
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
