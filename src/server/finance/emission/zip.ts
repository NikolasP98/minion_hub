import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

/** SUNAT's file naming law: `{RUC}-{docType}-{SERIE}-{CORRELATIVO}`. */
export function emissionFileBaseName(ruc: string, docType: string, serie: string, correlativo: string): string {
  return `${ruc}-${docType}-${serie}-${correlativo}`;
}

/** Zips the signed XML under `{fileBaseName}.xml` inside `{fileBaseName}.zip`, as SUNAT requires. */
export function zipInvoiceXml(fileBaseName: string, xml: string): Uint8Array {
  return zipSync({ [`${fileBaseName}.xml`]: strToU8(xml) }, { level: 6 });
}

/** Unzips a CDR (or any single/multi-entry SUNAT zip) into filename -> decoded text. */
export function unzipToText(bytes: Uint8Array): Record<string, string> {
  const entries = unzipSync(bytes);
  const out: Record<string, string> = {};
  for (const [name, data] of Object.entries(entries)) out[name] = strFromU8(data);
  return out;
}
