import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

vi.mock('$server/services/finance.service', () => ({
  getSource: vi.fn(),
}));
vi.mock('$server/services/finance-secrets', () => ({
  decryptCreds: vi.fn(() => ({ username: 'u', password: 'p', clientSecret: 's' })),
}));

const mockPeriodosRce = vi.fn();
const mockResumenComprobantes = vi.fn();
vi.mock('$server/finance/connectors/sunat-sire-client', () => ({
  SunatSireClient: class {
    periodosRce = mockPeriodosRce;
    resumenComprobantes = mockResumenComprobantes;
  },
}));

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1', profileId: 'user-1' });

const SAMPLE_CSV =
  'Tipo de Documento|Total Documentos|BI Gravado DG|IGV / IPM DG|BI Gravado DGNG|IGV / IPM DGNG|BI Gravado DNG|IGV / IPM DNG|Valor Adq. NG|ISC|ICBPER|Otros Trib/ Cargos|Total CP\n' +
  '01-Factura|34|21911.59|3944.11|0.00|0.00|0.00|0.00|279.33|0.00|0.00|50.87|26185.91\n' +
  '30-Documentos emitidos por Adquiriente|1|1500.03|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|1500.03\n' +
  'TOTAL |35|23411.62|3944.11|0.00|0.00|0.00|0.00|279.33|0.00|0.00|50.87|27685.94\n';

describe('parseResumenCsv', () => {
  it('parses the live SUNAT resumen shape (verified 2026-08-14) into rows + totals', async () => {
    const { parseResumenCsv } = await import('./purchases.service');
    const { rows, totals } = parseResumenCsv(SAMPLE_CSV);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      docTypeCode: '01',
      docTypeLabel: 'Factura',
      count: 34,
      baseGravada: 21911.59,
      igv: 3944.11,
      total: 26185.91,
    });
    expect(rows[1].docTypeCode).toBe('30');
    expect(totals).toEqual({
      docTypeCode: 'TOTAL',
      docTypeLabel: 'Total',
      count: 35,
      baseGravada: 23411.62,
      igv: 3944.11,
      total: 27685.94,
    });
  });

  it('returns empty on a header-only or blank CSV', async () => {
    const { parseResumenCsv } = await import('./purchases.service');
    expect(parseResumenCsv('Tipo|Documentos').rows).toEqual([]);
    expect(parseResumenCsv('').rows).toEqual([]);
  });
});

describe('periodStatusFromDesEstado', () => {
  it('maps SUNAT desEstado to open/closed', async () => {
    const { periodStatusFromDesEstado } = await import('./purchases.service');
    expect(periodStatusFromDesEstado('No Presentado')).toBe('open');
    expect(periodStatusFromDesEstado('Presentado')).toBe('closed');
  });
});

describe('purchase CRUD locking guards', () => {
  it('createPurchase rejects into a closed period', async () => {
    const { createPurchase, PurchasesError } = await import('./purchases.service');
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ orgId: 'org-1', period: '202607', status: 'closed' }]]); // getPeriodRow
    await expect(
      createPurchase(ctx(db), { period: '202607', supplierName: 'Acme' }),
    ).rejects.toThrow(PurchasesError);
  });

  it('createPurchase allows into an open period (or an unsynced/unknown one)', async () => {
    const { createPurchase } = await import('./purchases.service');
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [], // getPeriodRow — no period row yet (never synced) → treated as open
      [{ id: 'p-1', source: 'manual', period: '202608' }], // insert().returning()
    ]);
    const row = await createPurchase(ctx(db), { period: '202608', supplierName: 'Acme' });
    expect(row.id).toBe('p-1');
  });

  it('createPurchase rejects a malformed period', async () => {
    const { createPurchase, PurchasesError } = await import('./purchases.service');
    const { db } = createMockDb();
    await expect(createPurchase(ctx(db), { period: 'bad', supplierName: 'x' })).rejects.toThrow(
      PurchasesError,
    );
  });

  it('updatePurchase rejects once the period is closed', async () => {
    const { updatePurchase, PurchasesError } = await import('./purchases.service');
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'p-1', orgId: 'org-1', period: '202607', syncState: 'synced' }], // select existing
      [{ orgId: 'org-1', period: '202607', status: 'closed' }], // getPeriodRow
    ]);
    await expect(updatePurchase(ctx(db), 'p-1', { supplierName: 'New name' })).rejects.toThrow(
      PurchasesError,
    );
  });

  it('updatePurchase flips a synced row to diverged on edit', async () => {
    const { updatePurchase } = await import('./purchases.service');
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [
        {
          id: 'p-1',
          orgId: 'org-1',
          period: '202608',
          syncState: 'synced',
          supplierRuc: null,
          supplierName: 'Old',
          docType: '01',
          serie: null,
          numero: null,
          issuedAt: null,
          currency: 'PEN',
          baseGravada: null,
          igv: null,
          total: null,
        },
      ],
      [{ orgId: 'org-1', period: '202608', status: 'open' }], // getPeriodRow
      [{ id: 'p-1', syncState: 'diverged', supplierName: 'New name' }], // update().returning()
    ]);
    const row = await updatePurchase(ctx(db), 'p-1', { supplierName: 'New name' });
    expect(row.syncState).toBe('diverged');
  });

  it('deletePurchase rejects once the period is closed', async () => {
    const { deletePurchase, PurchasesError } = await import('./purchases.service');
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'p-1', orgId: 'org-1', period: '202607' }],
      [{ orgId: 'org-1', period: '202607', status: 'closed' }],
    ]);
    await expect(deletePurchase(ctx(db), 'p-1')).rejects.toThrow(PurchasesError);
  });
});

describe('syncPurchases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('never overwrites a diverged row and reports it skipped', async () => {
    const { getSource } = await import('$server/services/finance.service');
    (getSource as ReturnType<typeof vi.fn>).mockResolvedValue({
      enabled: true,
      secretRefs: { ciphertext: 'x', iv: 'y' },
      config: { ruc: '20611172967', clientId: 'client-1' },
    });
    mockPeriodosRce.mockResolvedValue([
      { perTributario: '202608', codEstado: '03', desEstado: 'No Presentado' },
    ]);
    // Single-row CSV keeps the mock-db call sequence tractable.
    mockResumenComprobantes.mockResolvedValue(
      'Tipo|Documentos|BI|IGV|a|b|c|d|e|f|g|Total\n01-Factura|1|100.00|18.00|0|0|0|0|0|0|0|118.00\nTOTAL |1|100.00|18.00|0|0|0|0|0|0|0|118.00\n',
    );
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      undefined, // periods upsert
      [{ id: 'existing-1', syncState: 'diverged', periodStatus: 'open' }], // select existing purchase row
      // diverged + periodStatus already 'open' matching computed status → no update issued
      undefined, // final period_status refresh update
    ]);

    const { syncPurchases } = await import('./purchases.service');
    const result = await syncPurchases(ctx(db));
    expect(result.periodsSynced).toBe(1);
    expect(result.purchasesUpserted).toBe(0);
    expect(result.divergedSkipped).toEqual(['202608:01']);
  });

  it('upserts a non-diverged row and counts it', async () => {
    const { getSource } = await import('$server/services/finance.service');
    (getSource as ReturnType<typeof vi.fn>).mockResolvedValue({
      enabled: true,
      secretRefs: { ciphertext: 'x', iv: 'y' },
      config: { ruc: '20611172967', clientId: 'client-1' },
    });
    mockPeriodosRce.mockResolvedValue([
      { perTributario: '202608', codEstado: '03', desEstado: 'No Presentado' },
    ]);
    mockResumenComprobantes.mockResolvedValue(
      'Tipo|Documentos|BI|IGV|a|b|c|d|e|f|g|Total\n01-Factura|1|100.00|18.00|0|0|0|0|0|0|0|118.00\nTOTAL |1|100.00|18.00|0|0|0|0|0|0|0|118.00\n',
    );
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      undefined, // periods upsert
      [], // select existing purchase row — none found
      undefined, // insert onConflictDoUpdate
      undefined, // final period_status refresh update
    ]);

    const { syncPurchases } = await import('./purchases.service');
    const result = await syncPurchases(ctx(db));
    expect(result.periodsSynced).toBe(1);
    expect(result.purchasesUpserted).toBe(1);
    expect(result.divergedSkipped).toEqual([]);
  });

  it('throws when the sunat-sire source has no credentials', async () => {
    const { getSource } = await import('$server/services/finance.service');
    (getSource as ReturnType<typeof vi.fn>).mockResolvedValue({
      enabled: true,
      secretRefs: {},
      config: {},
    });
    const { syncPurchases, PurchasesError } = await import('./purchases.service');
    const { db } = createMockDb();
    await expect(syncPurchases(ctx(db))).rejects.toThrow(PurchasesError);
  });
});
