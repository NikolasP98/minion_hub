import { describe, it, expect, vi, afterEach } from 'vitest';
import { sunatSireConnector, resolvePeriods } from './sunat-sire-connector';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
afterEach(() => vi.restoreAllMocks());

const PERIODS = [
  { perTributario: '202608', codEstado: '03', desEstado: 'No Presentado' },
  { perTributario: '202607', codEstado: '01', desEstado: 'Presentado' },
  { perTributario: '202606', codEstado: '01', desEstado: 'Presentado' },
];

describe('resolvePeriods', () => {
  it('defaults to the open (non-presented) periods', () => {
    expect(resolvePeriods(PERIODS, {})).toEqual(['202608']);
  });
  it('a since inside presented history backfills from that period', () => {
    expect(resolvePeriods(PERIODS, { since: '2026-06-15T00:00:00Z' })).toEqual(['202606', '202607', '202608']);
  });
  it('a fresh since never skips an open period — presented is the only lock', () => {
    // watermark says "yesterday" but August is still open → August is re-pulled whole
    expect(resolvePeriods(PERIODS, { since: '2026-08-13T00:00:00Z' })).toEqual(['202608']);
  });
  it('startPeriod is the first-run backfill knob', () => {
    expect(resolvePeriods(PERIODS, { startPeriod: '202607' })).toEqual(['202607', '202608']);
  });
});

const config = { ruc: '20611172967', clientId: 'CID' };
const secrets = { username: 'NIKO1998', password: 'pw', clientSecret: 'cs' };
const row = (n: number) => ({ codCar: `car-${n}`, numSerieCDP: 'BE01', numCDP: String(n), codTipoCDP: '03' });

describe('sunatSireConnector.pullPages', () => {
  it('logs in with RUC+user, pages a period, and chains cursors', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ access_token: 'TOK', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse([{ lisPeriodos: PERIODS }]))
      .mockResolvedValueOnce(jsonResponse({ paginacion: { page: 1, perPage: 100, totalRegistros: 150 }, registros: [row(1)] }))
      .mockResolvedValueOnce(jsonResponse({ paginacion: { page: 2, perPage: 100, totalRegistros: 150 }, registros: [row(2)] }));
    const pages = [];
    for await (const p of sunatSireConnector.pullPages({ config, secrets })) pages.push(p);
    // token request carries SUNAT's concatenated RUC+user
    expect(String(fetchMock.mock.calls[0][1]?.body)).toContain('username=20611172967NIKO1998');
    // API calls carry the Bearer token
    expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({ Authorization: 'Bearer TOK' });
    expect(pages).toHaveLength(2);
    expect(pages[0].cursor).toBe('202608|2'); // more rows in the period
    expect(pages[0].invoices[0].documentId).toBe('BE01-1');
    expect(pages[1].cursor).toBeNull(); // drained
  });

  it('resumes from a "PERIODO|PAGE" cursor without refetching earlier pages', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ access_token: 'TOK', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse([{ lisPeriodos: PERIODS }]))
      .mockResolvedValueOnce(jsonResponse({ paginacion: { page: 2, perPage: 100, totalRegistros: 150 }, registros: [row(2)] }));
    const pages = [];
    for await (const p of sunatSireConnector.pullPages({ config, secrets, cursor: '202608|2' })) pages.push(p);
    expect(pages).toHaveLength(1);
    expect(pages[0].cursor).toBeNull();
    expect(String(fetchMock.mock.calls[2][0])).toContain('page=2');
  });

  it('refuses to run with incomplete credentials', async () => {
    const it_ = sunatSireConnector.pullPages({ config, secrets: { username: 'u', password: 'p' } });
    await expect(it_[Symbol.asyncIterator]().next()).rejects.toThrow(/clientSecret/);
  });
});

describe('sunatSireConnector.count', () => {
  it('sums totalRegistros across the resolved periods', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ access_token: 'TOK', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse([{ lisPeriodos: PERIODS }]))
      .mockResolvedValueOnce(jsonResponse({ paginacion: { page: 1, perPage: 1, totalRegistros: 59 }, registros: [] }));
    expect(await sunatSireConnector.count!({ config, secrets })).toBe(59);
  });

  it('surfaces a bad credential as a thrown error (sources PUT probe)', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ error: 'unauthorized_client', error_description: 'cliente no autorizado' }, 401));
    await expect(sunatSireConnector.count!({ config, secrets })).rejects.toThrow(/401|no autorizado/);
  });
});
