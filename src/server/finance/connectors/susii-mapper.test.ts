import { describe, it, expect } from 'vitest';
import { mapSusiiSale } from './susii-mapper';

const SALE = {
  id: 36949872, number: 'BE01-2164', date: '2026-06-16T17:54:00Z', currency_code: 'PEN',
  exchange_rate: '3.73', tax: '68.64', discount: '50', is_paid: true, is_active: true,
  observations: 'x', user: 'facesperu',
  client: { id: 11, name: 'MORALES BERMUDEZ', document_type: 'DNI', document_number: '40853705', email: null, phone: null },
  items: [{ id: 1, code: 'AF2', name: 'Afinamiento Facial', quantity: '1', price: '500', tax: '76.27', discount: '0', selectors: [] }],
  payments: [{ id: 9, date: '2026-06-16T17:54:00Z', method: 'Tarjeta de Crédito', amount: '450', is_paid: true }],
  document_set: [{ id: 5, serial: 'BE01', total: '450' }],
};

describe('mapSusiiSale', () => {
  it('maps CORE fields + DNI + items + payments, stashing extras in metadata', () => {
    const inv = mapSusiiSale(SALE);
    expect(inv.provider).toBe('susii');
    expect(inv.providerRef).toBe('36949872');
    expect(inv.number).toBe('BE01-2164');
    expect(inv.clientDocNumber).toBe('40853705');
    expect(inv.currency).toBe('PEN');
    expect(inv.status).toBe('paid');
    expect(inv.items[0]).toMatchObject({ code: 'AF2', description: 'Afinamiento Facial', quantity: 1, unitPrice: 500 });
    expect(inv.payments[0]).toMatchObject({ method: 'Tarjeta de Crédito', amount: 450, status: 'paid' });
    expect(inv.client?.docNumber).toBe('40853705');
    expect(inv.metadata.exchange_rate).toBe('3.73');     // non-core extra preserved
  });
  it('normalises the all-same-digit placeholder DNI to null but keeps real docs', () => {
    const ph = mapSusiiSale({ id: 1, client: { id: 5, name: 'WALK IN', document_number: '00000000' } });
    expect(ph.client?.docNumber).toBeNull();
    expect(ph.clientDocNumber).toBeNull();
    const real = mapSusiiSale({ id: 2, client: { id: 6, name: 'REAL', document_number: '40853705' } });
    expect(real.client?.docNumber).toBe('40853705');
  });
  it('maps an unpaid sale to status pending and tolerates missing nested arrays', () => {
    const inv = mapSusiiSale({ id: 7, is_paid: false, client: null });
    expect(inv.status).toBe('pending');
    expect(inv.items).toEqual([]);
    expect(inv.payments).toEqual([]);
    expect(inv.client).toBeNull();
  });
});

describe('docless sale totals (SUSII sends no sale.total)', () => {
  // Production sale #3554 (2026-06-01): no document_set, SUSII UI shows S/ 1,300.
  const docless = {
    id: 38813907,
    number: '3554',
    date: '2026-06-01T19:27:28-05:00',
    tax: '198.3100000000',
    discount: '42.3700000000',
    other_charges: '0.00',
    rounding: '0.00',
    document_set: [],
    items: [{ name: 'Procedimiento', quantity: 1, price: 1144.0677966102, total: 1144.0677966102 }],
  };

  it('derives the total from the sale money fields when there is no document', () => {
    // 1144.07 + 198.31 - 42.37 = 1300.01 (SUSII shows S/ 1,300)
    expect(mapSusiiSale(docless).total).toBe(1300.01);
  });

  it('still prefers the document total when a document exists', () => {
    const withDoc = { ...docless, document_set: [{ serial: 'BE01-2105', total: 1200 }] };
    expect(mapSusiiSale(withDoc).total).toBe(1200);
  });

  it('leaves the total unknown rather than inventing 0 when there are no lines', () => {
    expect(mapSusiiSale({ ...docless, items: [] }).total).toBeNull();
  });
});
