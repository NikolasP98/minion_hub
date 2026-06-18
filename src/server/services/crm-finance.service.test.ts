import { describe, it, expect, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
const bothEnabled = vi.fn(async () => true);
vi.mock('./modules.service', () => ({ bothEnabled: (...a: unknown[]) => bothEnabled() }));
import { contactFinanceMap } from './crm-finance.service';
const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

describe('contactFinanceMap', () => {
  it('returns {} when bothEnabled is false', async () => {
    bothEnabled.mockResolvedValueOnce(false);
    const { db } = createMockDb();
    expect(await contactFinanceMap(ctx(db))).toEqual({});
  });
  it('keys aggregates by contact_id and classifies a repeat procedure buyer', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ contact_id: 'c1', revenue: 500, invoices: 3, last: '2026-01-01T00:00:00Z', purchased: true, has_reserva: true, proc_dates: 2 }]);
    const map = await contactFinanceMap(ctx(db));
    expect(map['c1']).toEqual({ revenue: 500, invoices: 3, lastPurchaseAt: '2026-01-01T00:00:00Z', purchased: true, reservedOnly: false, loyal: true });
  });
  it('flags a deposit-only contact as reservedOnly', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ contact_id: 'c2', revenue: 50, invoices: 1, last: '2026-02-01T00:00:00Z', purchased: false, has_reserva: true, proc_dates: 0 }]);
    const map = await contactFinanceMap(ctx(db));
    expect(map['c2']).toMatchObject({ purchased: false, reservedOnly: true, loyal: false });
  });
});
