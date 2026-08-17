#!/usr/bin/env bun
/**
 * Manual live-beta smoke test — run with `bun scripts/emit-beta-test.ts` after
 * `scripts/gen-beta-cert.sh`. Emits one boleta (B999-1, DNI client) and one
 * factura (F999-1, RUC client) to SUNAT's public beta sandbox and prints the
 * CDR for each. DoD = both ResponseCode 0. Not a vitest file — SUNAT's beta
 * endpoint is a live network dependency, this is deliberately manual.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emitToBeta, type EmissionInvoice } from '../src/server/finance/emission/index.ts';

const certDir = join(import.meta.dirname, '..', '.beta-cert');
const certPem = readFileSync(join(certDir, 'cert.pem'), 'utf8');
const keyPem = readFileSync(join(certDir, 'key.pem'), 'utf8');

const today = new Date().toISOString().slice(0, 10);

/** IGV rate these synthetic payloads declare (fraction). Synthetic harness with
 *  no org behind it, so it is stated here rather than read from fin_settings. */
const RATE = 0.18;

const boleta: EmissionInvoice = {
  docType: '03',
  serie: 'B999',
  correlativo: '1',
  issueDate: today,
  currency: 'PEN',
  igvRate: RATE,
  emitter: {
    ruc: '20611172967',
    razonSocial: 'FACES BETA SAC',
    ubigeo: '150101',
    address: 'AV BETA 123, LIMA',
  },
  client: { docType: '1', docNumber: '12345678', name: 'CLIENTE DE PRUEBA' },
  lines: [
    { description: 'Servicio de prueba 1', quantity: 1, unitPriceInclTax: 118 },
    { description: 'Servicio de prueba 2', quantity: 2, unitPriceInclTax: 59.9 },
  ],
};

const factura: EmissionInvoice = {
  ...boleta,
  docType: '01',
  serie: 'F999',
  client: { docType: '6', docNumber: '20611172967', name: 'EMPRESA DE PRUEBA SAC' },
};

for (const [label, inv] of [
  ['boleta', boleta],
  ['factura', factura],
] as const) {
  console.log(`\n--- emitting ${label} ${inv.serie}-${inv.correlativo} ---`);
  try {
    const cdr = await emitToBeta(inv, certPem, keyPem);
    console.log(cdr);
  } catch (e) {
    console.error(e);
  }
  await new Promise((r) => setTimeout(r, 3000)); // beta gateway rate-limits back-to-back requests
}
