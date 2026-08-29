#!/usr/bin/env bun
/**
 * Manual live-beta smoke test — run with `bun scripts/emit-beta-test.ts` after
 * `scripts/gen-beta-cert.sh`. Emits one boleta (B999-1, DNI client) and one
 * factura (F999-1, RUC client) to SUNAT's public beta sandbox and prints the
 * CDR for each. DoD = both ResponseCode 0. Not a vitest file — SUNAT's beta
 * endpoint is a live network dependency, this is deliberately manual.
 *
 * TODO(handoff): the parameterized-rate re-verification this script exists for
 * has NOT been run. S3 of specs/2026-08-17-hub-igv-rate-from-org-config-spec.md
 * §6 step 3 requires a live run at `--rate 0.18` AND at `--rate 0.10` (plus
 * `scripts/summary-beta-test.ts --rate 0.10`), with the four CDR descriptions
 * recorded, because SUNAT's own validator is the only thing that can confirm a
 * non-statutory `cbc:Percent` and its line arithmetic are accepted rather than
 * rejected with "totales no consistentes". The agent that shipped S3 has no
 * SUNAT beta certificate and no network egress in its sandbox, and must never
 * fabricate a CDR — the unit suite proves the totals invariant at
 * {0.18, 0.10, 0.08, 0.05} (`ubl.test.ts`, "S3 — totals-consistency invariant")
 * but a green suite with a rejected document is not done. Whoever holds
 * `.beta-cert` (see scripts/gen-beta-cert.sh): run both rates, paste the CDRs
 * into the spec's lifecycle evidence, and delete this note.
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
