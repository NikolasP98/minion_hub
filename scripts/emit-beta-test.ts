#!/usr/bin/env bun
/**
 * Manual live-beta smoke test — run with `bun scripts/emit-beta-test.ts` after
 * `scripts/gen-beta-cert.sh`. Emits one boleta (B999-1, DNI client) and one
 * factura (F999-1, RUC client) to SUNAT's public beta sandbox and prints the
 * CDR for each. DoD = both ResponseCode 0. Not a vitest file — SUNAT's beta
 * endpoint is a live network dependency, this is deliberately manual.
 *
 * RUN OF RECORD — 2026-08-29, cert from `bash scripts/gen-beta-cert.sh`
 * (self-signed; beta registers no certificate). Full matrix and the decision
 * it drove: `specs/2026-08-17-hub-igv-rate-from-org-config-s3-actuals.md`.
 *   - default rate (0.18): boleta B999-1 and factura F999-1 both accepted,
 *     CDR `ResponseCode 0`.
 *   - `--rate 0.10`: BOTH documents rejected by `sendBill` with fault
 *     `soap-env:Client.3462` — "La tasa del IGV debe ser la misma en todas las
 *     lineas o items del documento y debe corresponder con una tasa vigente".
 * That is why `$lib/finance/igv-rates` allows 0.18 only, and why this script
 * still accepts `--rate`: it is the harness that PROVES a candidate rate,
 * before the allowlist may grow. A rate is only addable once this script
 * returns `ResponseCode 0` for it against a production-equivalent emitter.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emitToBeta, type EmissionInvoice } from '../src/server/finance/emission/index.ts';
import { rateArg } from './_rate-arg.ts';

const certDir = join(import.meta.dirname, '..', '.beta-cert');
const certPem = readFileSync(join(certDir, 'cert.pem'), 'utf8');
const keyPem = readFileSync(join(certDir, 'key.pem'), 'utf8');

const today = new Date().toISOString().slice(0, 10);
const igvRate = rateArg(); // `--rate 0.10` to exercise a non-statutory rate against SUNAT

const boleta: EmissionInvoice = {
  docType: '03',
  serie: 'B999',
  correlativo: '1',
  issueDate: today,
  currency: 'PEN',
  igvRate,
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
  console.log(
    `\n--- emitting ${label} ${inv.serie}-${inv.correlativo} at IGV ${igvRate * 100}% ---`,
  );
  try {
    const cdr = await emitToBeta(inv, certPem, keyPem);
    console.log(cdr);
  } catch (e) {
    console.error(e);
  }
  await new Promise((r) => setTimeout(r, 3000)); // beta gateway rate-limits back-to-back requests
}
