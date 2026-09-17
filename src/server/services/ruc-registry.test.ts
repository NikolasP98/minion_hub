import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { PERUDEVS_API_KEY: 'k' } }));

import { lookupRuc, lookupRucConfigured, parseRucResponse } from './ruc-registry';

// Verbatim shapes from the live probe of 2026-09-17 (20511417253 / 20999999999).
const found = {
  estado: true,
  mensaje: 'Encontrado',
  resultado: {
    id: '20511417253',
    razon_social: 'LABORATORIOS BIOPAS SOCIEDAD ANONIMA CERRADA',
    condicion: 'HABIDO',
    nombre_comercial: 'LABORATORIOS BIOPAS S.A.C.',
    tipo: 'SOCIEDAD ANONIMA CERRADA',
    estado: 'ACTIVO',
    direccion: 'AV. MANUEL OLGUIN NRO. 335 INT. 502 URB.  MONTERRICO CHICO',
  },
};
const missing = {
  estado: false,
  mensaje: 'No se ha encontrado a la persona en la base de datos pública',
};

describe('parseRucResponse', () => {
  it('maps a RUC 20 hit to the company fields', () => {
    expect(parseRucResponse(200, found)).toEqual({
      status: 'found',
      company: {
        ruc: '20511417253',
        legalName: 'LABORATORIOS BIOPAS SOCIEDAD ANONIMA CERRADA',
        tradeName: 'LABORATORIOS BIOPAS S.A.C.',
        companyType: 'SOCIEDAD ANONIMA CERRADA',
        address: 'AV. MANUEL OLGUIN NRO. 335 INT. 502 URB.  MONTERRICO CHICO',
        active: true,
      },
    });
  });

  it('treats the registry "-" placeholders as absent (RUC 10 shape)', () => {
    const r = parseRucResponse(200, {
      estado: true,
      resultado: {
        id: '10123456789',
        razon_social: 'JIMENEZ DIAZ MARIA ISABEL',
        nombre_comercial: '-',
        direccion: '-',
        estado: 'ACTIVO',
      },
    });
    expect(r.status).toBe('found');
    if (r.status === 'found') {
      expect(r.company.tradeName).toBeNull();
      expect(r.company.address).toBeNull();
    }
  });

  it('a 200 with estado:false is not_found, a 5xx is an error', () => {
    expect(parseRucResponse(200, missing)).toEqual({ status: 'not_found' });
    expect(parseRucResponse(404, null)).toEqual({ status: 'not_found' });
    expect(parseRucResponse(500, { mensaje: 'boom' })).toEqual({
      status: 'error',
      message: 'boom',
    });
  });
});

describe('lookupRuc', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('calls the documented endpoint once and serves the second call from cache', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(found), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const a = await lookupRuc('20511417253', 'secret');
    const b = await lookupRucConfigured('20511417253');
    expect(a.status).toBe('found');
    expect(b).toEqual(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.origin + url.pathname).toBe('https://api.perudevs.com/api/v1/ruc');
    expect(url.searchParams.get('document')).toBe('20511417253');
    expect(url.searchParams.get('key')).toBe('secret');
  });

  it('never caches an error, and rejects a non-11-digit input before fetching', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    expect((await lookupRuc('20999999998', 'k')).status).toBe('error');
    expect((await lookupRuc('20999999998', 'k')).status).toBe('error');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await lookupRuc('123', 'k')).status).toBe('error');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
