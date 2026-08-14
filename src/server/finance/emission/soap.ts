/** Beta sandbox — nothing sent here is legally binding. See spec 2026-08-14-sunat-emission-beta-spec.md. */
export const SUNAT_BETA_ENDPOINT = 'https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService';

/** Public SUNAT documentation credentials for the beta sandbox — not a real secret. */
export const SUNAT_BETA_USERNAME = '20611172967MODDATOS';
export const SUNAT_BETA_PASSWORD = 'MODDATOS';

/** Per-request timeout — a hung SUNAT response aborts instead of parking the caller forever. */
const REQUEST_TIMEOUT_MS = 30_000;

export interface SendBillOptions {
  username: string;
  password: string;
  endpoint?: string;
}

/** Namespace-agnostic single-tag text extractor — the SOAP responses here are
 * small and well-known, a full XML parser would be overkill. */
function extractTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`));
  return m ? m[1].trim() : null;
}

/**
 * Hand-built SOAP 1.1 `sendBill` call (no soap library — the envelope shape
 * was validated with curl already, see spec). WS-Security UsernameToken auth,
 * base64 zip in `contenido`. 30s timeout, no retries in this slice.
 */
export async function sendBill(
  fileName: string,
  zipBytes: Uint8Array,
  opts: SendBillOptions,
): Promise<{ cdrZip: Uint8Array }> {
  const endpoint = opts.endpoint ?? SUNAT_BETA_ENDPOINT;
  const contentBase64 = Buffer.from(zipBytes).toString('base64');
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
<soapenv:Header>
<wsse:Security>
<wsse:UsernameToken>
<wsse:Username>${opts.username}</wsse:Username>
<wsse:Password>${opts.password}</wsse:Password>
</wsse:UsernameToken>
</wsse:Security>
</soapenv:Header>
<soapenv:Body>
<ser:sendBill>
<fileName>${fileName}</fileName>
<contentFile>${contentBase64}</contentFile>
</ser:sendBill>
</soapenv:Body>
</soapenv:Envelope>`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml;charset=UTF-8', SOAPAction: '' },
      body: envelope,
      signal: ctrl.signal,
    });
  } catch (e) {
    throw e instanceof Error && e.name === 'AbortError'
      ? new Error(`SUNAT sendBill timed out after ${REQUEST_TIMEOUT_MS}ms`)
      : e;
  } finally {
    clearTimeout(t);
  }

  const text = await res.text();
  const faultstring = extractTag(text, 'faultstring');
  if (faultstring) {
    const faultcode = extractTag(text, 'faultcode') ?? 'unknown';
    throw new Error(`SUNAT sendBill fault (${faultcode}): ${faultstring}`);
  }
  const applicationResponse = extractTag(text, 'applicationResponse');
  if (!applicationResponse) {
    throw new Error(`SUNAT sendBill: no applicationResponse in reply (HTTP ${res.status}): ${text.slice(0, 500)}`);
  }
  return { cdrZip: Uint8Array.from(Buffer.from(applicationResponse, 'base64')) };
}
