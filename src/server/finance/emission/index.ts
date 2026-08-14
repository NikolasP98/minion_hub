import { parseCdr } from './cdr';
import { SUNAT_BETA_PASSWORD, SUNAT_BETA_USERNAME, getStatus, sendBill, sendSummary } from './soap';
import { signXml } from './sign';
import { bajaId, buildBajaXml, buildResumenXml, resumenId } from './summary';
import type { BajaOptions, ResumenOptions } from './summary';
import type { CdrResult, EmissionInvoice } from './types';
import { buildInvoiceXml } from './ubl';
import { emissionFileBaseName, zipInvoiceXml } from './zip';

export type { CdrResult, EmissionInvoice } from './types';
export type { BajaLine, BajaOptions, ResumenEstado, ResumenLine, ResumenOptions } from './summary';

/**
 * Orchestrates build -> sign -> zip -> send -> parse against SUNAT's beta
 * sandbox. Beta creds are hardcoded public documentation values (`MODDATOS`) —
 * this function never touches the production endpoint.
 */
export async function emitToBeta(inv: EmissionInvoice, certPem: string, keyPem: string): Promise<CdrResult> {
  const unsigned = buildInvoiceXml(inv);
  const signed = signXml(unsigned, keyPem, certPem);
  const fileBaseName = emissionFileBaseName(inv.emitter.ruc, inv.docType, inv.serie, inv.correlativo);
  const zipBytes = zipInvoiceXml(fileBaseName, signed);
  const { cdrZip } = await sendBill(`${fileBaseName}.zip`, zipBytes, {
    username: SUNAT_BETA_USERNAME,
    password: SUNAT_BETA_PASSWORD,
  });
  return parseCdr(cdrZip);
}

const POLL_MAX_ATTEMPTS = 10;
const POLL_INTERVAL_MS = 3_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls a `sendSummary` ticket every 3s (beta processes in seconds) until a
 * terminal `statusCode` — `0` (accepted) or `99` (rejected) both carry a CDR.
 * Throws if still `98` (in-process) after `POLL_MAX_ATTEMPTS`.
 */
async function pollTicket(ticket: string): Promise<CdrResult> {
  for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);
    const { statusCode, cdrZip } = await getStatus(ticket, {
      username: SUNAT_BETA_USERNAME,
      password: SUNAT_BETA_PASSWORD,
    });
    if (statusCode === '98') continue;
    if (!cdrZip) {
      throw new Error(`SUNAT getStatus ticket ${ticket}: statusCode ${statusCode} but no CDR`);
    }
    return parseCdr(cdrZip);
  }
  throw new Error(`SUNAT getStatus ticket ${ticket}: still in-process after ${POLL_MAX_ATTEMPTS} polls`);
}

/**
 * Orchestrates build -> sign -> zip -> sendSummary -> poll getStatus -> parse
 * CDR for a resumen diario (RC) against SUNAT's beta sandbox.
 */
export async function submitResumen(opts: ResumenOptions, certPem: string, keyPem: string): Promise<CdrResult> {
  const unsigned = buildResumenXml(opts);
  const signed = signXml(unsigned, keyPem, certPem);
  const fileBaseName = `${opts.emitter.ruc}-${resumenId(opts.issueDate, opts.correlativo)}`;
  const zipBytes = zipInvoiceXml(fileBaseName, signed);
  const { ticket } = await sendSummary(`${fileBaseName}.zip`, zipBytes, {
    username: SUNAT_BETA_USERNAME,
    password: SUNAT_BETA_PASSWORD,
  });
  return pollTicket(ticket);
}

/**
 * Orchestrates build -> sign -> zip -> sendSummary -> poll getStatus -> parse
 * CDR for a comunicación de baja (RA) against SUNAT's beta sandbox.
 */
export async function submitBaja(opts: BajaOptions, certPem: string, keyPem: string): Promise<CdrResult> {
  const unsigned = buildBajaXml(opts);
  const signed = signXml(unsigned, keyPem, certPem);
  const fileBaseName = `${opts.emitter.ruc}-${bajaId(opts.issueDate, opts.correlativo)}`;
  const zipBytes = zipInvoiceXml(fileBaseName, signed);
  const { ticket } = await sendSummary(`${fileBaseName}.zip`, zipBytes, {
    username: SUNAT_BETA_USERNAME,
    password: SUNAT_BETA_PASSWORD,
  });
  return pollTicket(ticket);
}
