import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BajaOptions, ResumenOptions } from './summary';
import type { EmissionInvoice } from './types';

vi.mock('./sign', () => ({ signXml: (xml: string) => xml }));

const sendSummaryMock = vi.fn();
const getStatusMock = vi.fn();
vi.mock('./soap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./soap')>();
  return {
    ...actual,
    sendSummary: (...args: Parameters<typeof actual.sendSummary>) => sendSummaryMock(...args),
    getStatus: (...args: Parameters<typeof actual.getStatus>) => getStatusMock(...args),
  };
});

// Import after the mocks so `submitResumen`/`submitBaja` pick up the mocked deps.
const { submitResumen, submitBaja } = await import('./index');

function cdrZip(responseCode: string, description: string): Uint8Array {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ApplicationResponse xmlns="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
<cac:DocumentResponse><cac:Response>
<cbc:ResponseCode>${responseCode}</cbc:ResponseCode>
<cbc:Description>${description}</cbc:Description>
</cac:Response></cac:DocumentResponse>
</ApplicationResponse>`;
  return zipSync({ 'R-1.xml': strToU8(xml) });
}

const boleta: EmissionInvoice = {
  docType: '03',
  serie: 'B998',
  correlativo: '1',
  issueDate: '2026-08-14',
  currency: 'PEN',
  igvRate: 0.18,
  emitter: { ruc: '20611172967', razonSocial: 'FACES BETA SAC' },
  client: { docType: '1', docNumber: '12345678', name: 'CLIENTE DE PRUEBA' },
  lines: [{ description: 'Servicio', quantity: 1, unitPriceInclTax: 118 }],
};

const resumenOpts: ResumenOptions = {
  emitter: { ruc: '20611172967', razonSocial: 'FACES BETA SAC' },
  correlativo: '1',
  referenceDate: '2026-08-14',
  issueDate: '2026-08-14',
  lines: [{ invoice: boleta, estado: '1' }],
};

const bajaOpts: BajaOptions = {
  emitter: { ruc: '20611172967', razonSocial: 'FACES BETA SAC' },
  correlativo: '1',
  referenceDate: '2026-08-14',
  issueDate: '2026-08-15',
  lines: [{ docType: '01', serie: 'F998', correlativo: '1', motivo: 'test' }],
};

beforeEach(() => {
  vi.useFakeTimers();
  sendSummaryMock.mockReset();
  getStatusMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('submitResumen', () => {
  it('polls through 98 (in-process) until statusCode 0 and parses the CDR', async () => {
    sendSummaryMock.mockResolvedValueOnce({ ticket: 'T1' });
    getStatusMock
      .mockResolvedValueOnce({ statusCode: '98' })
      .mockResolvedValueOnce({ statusCode: '98' })
      .mockResolvedValueOnce({ statusCode: '0', cdrZip: cdrZip('0', 'Resumen aceptado') });

    const promise = submitResumen(resumenOpts, 'cert', 'key');
    await vi.runAllTimersAsync();
    const cdr = await promise;

    expect(cdr).toEqual({ responseCode: '0', description: 'Resumen aceptado', notes: [] });
    expect(getStatusMock).toHaveBeenCalledTimes(3);
    expect(sendSummaryMock.mock.calls[0][0]).toBe('20611172967-RC-20260814-1.zip');
  });

  it('surfaces statusCode 99 (error) by returning its CDR rather than throwing', async () => {
    sendSummaryMock.mockResolvedValueOnce({ ticket: 'T2' });
    getStatusMock.mockResolvedValueOnce({ statusCode: '99', cdrZip: cdrZip('2800', 'Resumen rechazado') });

    const promise = submitResumen(resumenOpts, 'cert', 'key');
    await vi.runAllTimersAsync();
    const cdr = await promise;

    expect(cdr).toEqual({ responseCode: '2800', description: 'Resumen rechazado', notes: [] });
  });

  it('throws after exhausting the poll budget still in-process', async () => {
    sendSummaryMock.mockResolvedValueOnce({ ticket: 'T3' });
    getStatusMock.mockResolvedValue({ statusCode: '98' });

    const promise = submitResumen(resumenOpts, 'cert', 'key');
    // Attach a rejection handler before advancing timers so vitest doesn't
    // flag the eventual rejection as unhandled while polls are in flight.
    const assertion = expect(promise).rejects.toThrow(/still in-process after 10 polls/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(getStatusMock).toHaveBeenCalledTimes(10);
  });
});

describe('submitBaja', () => {
  it('builds the RA file name and parses the accepted CDR', async () => {
    sendSummaryMock.mockResolvedValueOnce({ ticket: 'T4' });
    getStatusMock.mockResolvedValueOnce({ statusCode: '0', cdrZip: cdrZip('0', 'Baja aceptada') });

    const promise = submitBaja(bajaOpts, 'cert', 'key');
    await vi.runAllTimersAsync();
    const cdr = await promise;

    expect(cdr).toEqual({ responseCode: '0', description: 'Baja aceptada', notes: [] });
    expect(sendSummaryMock.mock.calls[0][0]).toBe('20611172967-RA-20260815-1.zip');
  });
});
