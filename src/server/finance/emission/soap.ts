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

function securityEnvelope(opts: SendBillOptions, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
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
${body}
</soapenv:Body>
</soapenv:Envelope>`;
}

/** POSTs a SOAP envelope with the shared 30s-timeout/abort handling every
 * `billService` operation in this file needs — no soap library, `SOAPAction: ''`. */
async function postSoapEnvelope(endpoint: string, envelope: string, opName: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml;charset=UTF-8', SOAPAction: '' },
      body: envelope,
      signal: ctrl.signal,
    });
    return await res.text();
  } catch (e) {
    throw e instanceof Error && e.name === 'AbortError'
      ? new Error(`SUNAT ${opName} timed out after ${REQUEST_TIMEOUT_MS}ms`)
      : e;
  } finally {
    clearTimeout(t);
  }
}

function requireNoFault(opName: string, text: string): void {
  const faultstring = extractTag(text, 'faultstring');
  if (faultstring) {
    const faultcode = extractTag(text, 'faultcode') ?? 'unknown';
    throw new Error(`SUNAT ${opName} fault (${faultcode}): ${faultstring}`);
  }
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
  const envelope = securityEnvelope(
    opts,
    `<ser:sendBill>
<fileName>${fileName}</fileName>
<contentFile>${contentBase64}</contentFile>
</ser:sendBill>`,
  );

  const text = await postSoapEnvelope(endpoint, envelope, 'sendBill');
  requireNoFault('sendBill', text);
  const applicationResponse = extractTag(text, 'applicationResponse');
  if (!applicationResponse) {
    throw new Error(`SUNAT sendBill: no applicationResponse in reply: ${text.slice(0, 500)}`);
  }
  return { cdrZip: Uint8Array.from(Buffer.from(applicationResponse, 'base64')) };
}

/** `sendSummary` — submits an RC (resumen diario) or RA (comunicación de baja)
 * zip and returns SUNAT's async ticket. Same envelope/auth as `sendBill`. */
export async function sendSummary(
  fileName: string,
  zipBytes: Uint8Array,
  opts: SendBillOptions,
): Promise<{ ticket: string }> {
  const endpoint = opts.endpoint ?? SUNAT_BETA_ENDPOINT;
  const contentBase64 = Buffer.from(zipBytes).toString('base64');
  const envelope = securityEnvelope(
    opts,
    `<ser:sendSummary>
<fileName>${fileName}</fileName>
<contentFile>${contentBase64}</contentFile>
</ser:sendSummary>`,
  );

  const text = await postSoapEnvelope(endpoint, envelope, 'sendSummary');
  requireNoFault('sendSummary', text);
  const ticket = extractTag(text, 'ticket');
  if (!ticket) {
    throw new Error(`SUNAT sendSummary: no ticket in reply: ${text.slice(0, 500)}`);
  }
  return { ticket };
}

/**
 * `getStatus` — polls a `sendSummary` ticket. `statusCode`: `0` done (CDR in
 * `content`), `98` still in-process (no content), `99` error (CDR in `content`
 * explaining the rejection).
 */
export async function getStatus(
  ticket: string,
  opts: SendBillOptions,
): Promise<{ statusCode: string; cdrZip?: Uint8Array }> {
  const endpoint = opts.endpoint ?? SUNAT_BETA_ENDPOINT;
  const envelope = securityEnvelope(
    opts,
    `<ser:getStatus>
<ticket>${ticket}</ticket>
</ser:getStatus>`,
  );

  const text = await postSoapEnvelope(endpoint, envelope, 'getStatus');
  requireNoFault('getStatus', text);
  const statusCode = extractTag(text, 'statusCode');
  if (!statusCode) {
    throw new Error(`SUNAT getStatus: no statusCode in reply: ${text.slice(0, 500)}`);
  }
  const content = extractTag(text, 'content');
  return { statusCode, cdrZip: content ? Uint8Array.from(Buffer.from(content, 'base64')) : undefined };
}
