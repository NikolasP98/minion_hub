import { createHash } from 'node:crypto';
import { parseCdr } from './cdr';
import { SUNAT_BETA_PASSWORD, SUNAT_BETA_USERNAME, sendBill } from './soap';
import { signXml } from './sign';
import type { CdrResult, EmissionInvoice } from './types';
import { buildInvoiceXml } from './ubl';
import { emissionFileBaseName, zipInvoiceXml } from './zip';

export type { CdrResult, EmissionInvoice, EmissionLine, EmissionDocType, ClientDocType } from './types';

/** `emitToBeta`'s CDR plus a sha256 audit hash of the signed XML — callers
 *  that must keep an audit trail (pos-emission.service.ts) persist ONLY this
 *  hash, never the XML itself. */
export interface EmitResult extends CdrResult {
  xmlHash: string;
}

/**
 * Orchestrates build -> sign -> zip -> send -> parse against SUNAT's beta
 * sandbox. Beta creds are hardcoded public documentation values (`MODDATOS`) —
 * this function never touches the production endpoint.
 */
export async function emitToBeta(
  inv: EmissionInvoice,
  certPem: string,
  keyPem: string,
): Promise<EmitResult> {
  const unsigned = buildInvoiceXml(inv);
  const signed = signXml(unsigned, keyPem, certPem);
  const xmlHash = createHash('sha256').update(signed).digest('hex');
  const fileBaseName = emissionFileBaseName(inv.emitter.ruc, inv.docType, inv.serie, inv.correlativo);
  const zipBytes = zipInvoiceXml(fileBaseName, signed);
  const { cdrZip } = await sendBill(`${fileBaseName}.zip`, zipBytes, {
    username: SUNAT_BETA_USERNAME,
    password: SUNAT_BETA_PASSWORD,
  });
  return { ...parseCdr(cdrZip), xmlHash };
}
