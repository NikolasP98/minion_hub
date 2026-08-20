#!/usr/bin/env bun
/**
 * Manual live-beta smoke test for shadow emission (spec 2026-08-14-pos-
 * shadow-emission-spec.md §6.2). Builds a synthetic ticket through
 * `ticketToEmission` — the SAME function `submitTicket` calls in shadow mode
 * — then emits it for real against SUNAT's beta sandbox via `emitToBeta`.
 * Run with `bun scripts/shadow-emit-test.ts` after `scripts/gen-beta-cert.sh`.
 * DoD = a pos_emissions-shaped result, status 'accepted', ResponseCode 0.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emitToBeta } from '../src/server/finance/emission/index.ts';
import {
  ticketToEmission,
  type PartyDocInfo,
  type EmitterConfig,
} from '../src/server/services/pos-emission-mapping.ts';
import { rateArg } from './_rate-arg.ts';

const certDir = join(import.meta.dirname, '..', '.beta-cert');
const certPem = readFileSync(join(certDir, 'cert.pem'), 'utf8');
const keyPem = readFileSync(join(certDir, 'key.pem'), 'utf8');

const emitter: EmitterConfig = {
  ruc: '20611172967',
  razonSocial: 'FACES BETA SAC',
  ubigeo: '150101',
  address: 'AV BETA 123, LIMA',
};

// A synthetic ticket shaped exactly like what submitTicket persists: two
// lines, a ticket-level discount, no customer -> the real-world common case
// (anonymous-consumer boleta below S/700).
const ticket = { subtotal: '237.80', total: '227.80' }; // S/10 ticket-level discount
const lines = [
  { description: 'Servicio de prueba 1', qty: '1', total: '118' },
  { description: 'Servicio de prueba 2', qty: '2', total: '119.80' },
];
const customer: PartyDocInfo | null = null;
const settings = { emission: { mode: 'shadow' as const, docTypeDefault: '03' as const } };
const allocation = { serie: 'B999', correlativo: 1 };
// No org behind a synthetic ticket, so the rate is explicit here — `--rate
// 0.10` puts a non-statutory document in front of SUNAT's real validator.
const igvRate = rateArg();

const { invoice, docRequired } = ticketToEmission(
  ticket,
  lines,
  customer,
  settings,
  allocation,
  emitter,
  igvRate,
);

console.log(
  `--- emitting ${invoice.docType} ${invoice.serie}-${invoice.correlativo} at IGV ${igvRate * 100}% (docRequired=${docRequired}) ---`,
);
const cdr = await emitToBeta(invoice, certPem, keyPem);

const accepted = cdr.responseCode === '0';
// pos_emissions-shaped result — this is exactly what runBetaEmission persists.
const emissionResult = {
  docType: invoice.docType,
  serie: invoice.serie,
  correlativo: allocation.correlativo,
  environment: 'beta' as const,
  status: accepted ? 'accepted' : 'rejected',
  responseCode: cdr.responseCode,
  responseDescription: docRequired ? `[DOC-REQUIRED] ${cdr.description}` : cdr.description,
  xmlHash: cdr.xmlHash,
  total: ticket.total,
  clientDocType: invoice.client.docType,
  clientDocNumber: invoice.client.docNumber,
};
console.log(emissionResult);

if (!accepted) {
  console.error(`DoD NOT met: expected status=accepted ResponseCode=0, got ResponseCode=${cdr.responseCode}`);
  process.exit(1);
}
console.log('DoD met: status=accepted ResponseCode=0');
