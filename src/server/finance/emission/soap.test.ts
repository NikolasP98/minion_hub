import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStatus, sendBill, sendSummary } from './soap';

function xmlResponse(body: string, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'text/xml' } });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sendBill', () => {
  it('extracts the base64 applicationResponse from a successful SOAP response', async () => {
    const cdrBase64 = Buffer.from('fake-cdr-zip-bytes').toString('base64');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      xmlResponse(`<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
<soapenv:Body><ser:sendBillResponse xmlns:ser="http://service.sunat.gob.pe">
<applicationResponse>${cdrBase64}</applicationResponse>
</ser:sendBillResponse></soapenv:Body></soapenv:Envelope>`),
    );
    const { cdrZip } = await sendBill('20611172967-03-B999-1.zip', new Uint8Array([1, 2, 3]), {
      username: 'u',
      password: 'p',
    });
    expect(Buffer.from(cdrZip).toString()).toBe('fake-cdr-zip-bytes');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService');
    expect((init as RequestInit).body).toContain('<fileName>20611172967-03-B999-1.zip</fileName>');
    expect((init as RequestInit).body).toContain('<wsse:Username>u</wsse:Username>');
  });

  it('surfaces SUNAT SOAP faults with faultcode + faultstring', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      xmlResponse(`<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
<soapenv:Body><soapenv:Fault>
<faultcode>soap-env:Client.3244</faultcode>
<faultstring>Debe consignar la informacion del tipo de transaccion del comprobante</faultstring>
</soapenv:Fault></soapenv:Body></soapenv:Envelope>`, 500),
    );
    await expect(
      sendBill('x.zip', new Uint8Array(), { username: 'u', password: 'p' }),
    ).rejects.toThrow(/soap-env:Client\.3244.*tipo de transaccion/s);
  });

  it('rejects with a clear message when the reply has neither a fault nor applicationResponse', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(xmlResponse('<html>not soap</html>', 401));
    await expect(
      sendBill('x.zip', new Uint8Array(), { username: 'u', password: 'p' }),
    ).rejects.toThrow(/no applicationResponse/);
  });
});

describe('sendSummary', () => {
  it('extracts the ticket from a successful SOAP response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      xmlResponse(`<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
<soapenv:Body><ser:sendSummaryResponse xmlns:ser="http://service.sunat.gob.pe">
<ticket>1234567890</ticket>
</ser:sendSummaryResponse></soapenv:Body></soapenv:Envelope>`),
    );
    const { ticket } = await sendSummary('20611172967-RC-20260814-1.zip', new Uint8Array([1, 2, 3]), {
      username: 'u',
      password: 'p',
    });
    expect(ticket).toBe('1234567890');
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).body).toContain('<fileName>20611172967-RC-20260814-1.zip</fileName>');
  });

  it('surfaces SUNAT SOAP faults with faultcode + faultstring', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      xmlResponse(`<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
<soapenv:Body><soapenv:Fault>
<faultcode>soap-env:Client.0111</faultcode>
<faultstring>El archivo XML esta mal formado</faultstring>
</soapenv:Fault></soapenv:Body></soapenv:Envelope>`, 500),
    );
    await expect(
      sendSummary('x.zip', new Uint8Array(), { username: 'u', password: 'p' }),
    ).rejects.toThrow(/soap-env:Client\.0111.*mal formado/s);
  });
});

describe('getStatus', () => {
  it('parses statusCode 98 (in-process) with no content', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      xmlResponse(`<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
<soapenv:Body><ser:getStatusResponse xmlns:ser="http://service.sunat.gob.pe">
<status><statusCode>98</statusCode></status>
</ser:getStatusResponse></soapenv:Body></soapenv:Envelope>`),
    );
    const result = await getStatus('1234567890', { username: 'u', password: 'p' });
    expect(result).toEqual({ statusCode: '98', cdrZip: undefined });
  });

  it('parses statusCode 0 (done) with a base64 CDR in content', async () => {
    const cdrBase64 = Buffer.from('fake-cdr-zip-bytes').toString('base64');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      xmlResponse(`<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
<soapenv:Body><ser:getStatusResponse xmlns:ser="http://service.sunat.gob.pe">
<status><statusCode>0</statusCode><content>${cdrBase64}</content></status>
</ser:getStatusResponse></soapenv:Body></soapenv:Envelope>`),
    );
    const { statusCode, cdrZip } = await getStatus('1234567890', { username: 'u', password: 'p' });
    expect(statusCode).toBe('0');
    expect(Buffer.from(cdrZip!).toString()).toBe('fake-cdr-zip-bytes');
  });

  it('parses statusCode 99 (error) with a CDR explaining the rejection', async () => {
    const cdrBase64 = Buffer.from('fake-error-cdr').toString('base64');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      xmlResponse(`<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
<soapenv:Body><ser:getStatusResponse xmlns:ser="http://service.sunat.gob.pe">
<status><statusCode>99</statusCode><content>${cdrBase64}</content></status>
</ser:getStatusResponse></soapenv:Body></soapenv:Envelope>`),
    );
    const { statusCode, cdrZip } = await getStatus('1234567890', { username: 'u', password: 'p' });
    expect(statusCode).toBe('99');
    expect(Buffer.from(cdrZip!).toString()).toBe('fake-error-cdr');
  });
});
