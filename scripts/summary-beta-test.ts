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
 * requires re-running this (and emit-beta-test.ts) at --rate 0.10 against
 * SUNAT's live beta validator and pasting the CDR ResponseCode/description
 * into the shipping PR. Not run in this pass — no `.beta-cert` (real
 * signing cert) is available in this environment. See the proposal
 * 2026-08-17-hub-igv-rate-from-org-config for the open-items entry.
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
