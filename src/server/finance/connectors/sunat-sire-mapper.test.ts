import { describe, it, expect } from 'vitest';
import { mapSireRegistro } from './sunat-sire-mapper';

/** Shape taken verbatim from a real RVIE propuesta pull (2026-08-14). */
const registro = {
  id: '6a6ede2bb15a15e43095dbf8',
  numRuc: '20611172967',
  nomRazonSocial: 'FACES SCULPTORS S.A.C.',
  perPeriodoTributario: '202608',
  codCar: '2061117296703BE010000002376',
  codTipoCDP: '03',
  numSerieCDP: 'BE01',
  numCDP: '2376',
  codTipoCarga: '1',
  codSituacion: '1',
  codEstadoComprobante: '1',
  desEstadoComprobante: 'Activo',
  fecEmision: '01/08/2026',
  codTipoDocIdentidad: '1',
  numDocIdentidad: '48527624',
  nomRazonSocialCliente: '-',
  codMoneda: 'PEN',
  mtoBIGravada: 1101.69,
  mtoDsctoBI: 0.0,
  mtoIGV: 198.31,
  mtoTotalCP: 1300.0,
};

describe('mapSireRegistro', () => {
  it('maps a boleta row to the canonical invoice shape', () => {
    const inv = mapSireRegistro(registro);
    expect(inv.provider).toBe('sunat-sire');
    expect(inv.providerRef).toBe('2061117296703BE010000002376'); // codCar, stable across pulls
    expect(inv.documentId).toBe('BE01-2376');
    expect(inv.number).toBe('BE01-2376');
    expect(inv.issuedAt).toBe('2026-08-01'); // dd/mm/yyyy → ISO
    expect(inv.currency).toBe('PEN');
    expect(inv.subtotal).toBe(1101.69);
    expect(inv.tax).toBe(198.31);
    expect(inv.total).toBe(1300.0);
    expect(inv.status).toBeNull(); // SIRE knows validity, not collection state
    expect(inv.items).toEqual([]);
    expect(inv.payments).toEqual([]);
    expect(inv.metadata).toBe(registro); // whole raw row preserved
  });

  it('keeps the client identity but nulls the "-" placeholder name', () => {
    const inv = mapSireRegistro(registro);
    expect(inv.client).toMatchObject({ providerRef: '1:48527624', docType: 'DNI', docNumber: '48527624', name: null });
    expect(inv.clientDocType).toBe('DNI');
    expect(inv.clientDocNumber).toBe('48527624');
  });

  it('drops all-same-digit sentinel documents instead of inventing a client', () => {
    const inv = mapSireRegistro({ ...registro, numDocIdentidad: '00000000' });
    expect(inv.client).toBeNull();
    expect(inv.clientDocNumber).toBeNull();
  });

  it('marks anulado documents void', () => {
    const inv = mapSireRegistro({ ...registro, desEstadoComprobante: 'Anulado' });
    expect(inv.status).toBe('void');
  });
});
