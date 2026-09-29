import { describe, expect, it } from 'vitest';
import { entryDocument, warehouseSpan } from './entry-document';

describe('entryDocument', () => {
  it('links a POS issue to its ticket', () => {
    expect(entryDocument('issue', { source: 'pos', sourceId: 't1', ticketId: 't1' })).toEqual({
      kind: 'ticket',
      id: 't1',
      href: '/pos/tickets/t1',
      labelFallback: '#t1',
    });
  });

  it('links an invoice issue to its invoice, label falls back to providerRef', () => {
    expect(
      entryDocument('issue', { source: 'invoice', invoiceId: 'inv1', providerRef: 'F001-123' }),
    ).toEqual({
      kind: 'invoice',
      id: 'inv1',
      href: '/finances/invoices/inv1',
      labelFallback: 'F001-123',
    });
  });

  it('links a realized-accrual booking issue to its booking', () => {
    expect(entryDocument('issue', { source: 'booking', sourceId: 'bk1' })).toEqual({
      kind: 'booking',
      id: 'bk1',
      href: '/scheduling/bookings?booking=bk1',
      labelFallback: 'bk1',
    });
  });

  it('returns null for a receipt (no purchase link exists yet)', () => {
    expect(entryDocument('receipt', {})).toBeNull();
    expect(entryDocument('receipt', { source: 'pos', sourceId: 't1' })).toBeNull();
  });

  it('returns null for a legacy plain service issue', () => {
    expect(
      entryDocument('issue', { source: 'service', finProductId: 'p1', quantity: 2 }),
    ).toBeNull();
  });

  it('returns null for missing/unknown metadata', () => {
    expect(entryDocument('issue', {})).toBeNull();
    expect(entryDocument('issue', null)).toBeNull();
    expect(entryDocument('issue', { source: 'mystery' })).toBeNull();
  });
});

describe('warehouseSpan', () => {
  const names = { w1: 'Main', w2: 'Annex' };

  it('renders a transfer as "A → B"', () => {
    expect(warehouseSpan('w1', 'w2', names)).toBe('Main → Annex');
  });

  it('renders a single side when only one is set', () => {
    expect(warehouseSpan('w1', null, names)).toBe('Main');
    expect(warehouseSpan(null, 'w2', names)).toBe('Annex');
  });

  it('falls back to a short id when the name is unknown, and — when neither side is set', () => {
    expect(warehouseSpan('unknown-id-123', null, names)).toBe('unknown-');
    expect(warehouseSpan(null, null, names)).toBe('—');
  });
});
