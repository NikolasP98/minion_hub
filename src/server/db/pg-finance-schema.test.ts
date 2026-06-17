import { describe, it, expect } from 'vitest';
import { finInvoices, finInvoiceItems, finPayments, finClients, finSources } from './pg-finance-schema';

describe('pg-finance-schema', () => {
  it('fin_invoices has the CORE columns + metadata', () => {
    const cols = Object.keys(finInvoices);
    for (const c of ['orgId', 'provider', 'providerRef', 'number', 'documentId', 'issuedAt',
      'clientName', 'clientDocType', 'clientDocNumber', 'clientEmail', 'currency',
      'subtotal', 'tax', 'discount', 'total', 'status', 'seller', 'note', 'metadata', 'syncedAt']) {
      expect(cols).toContain(c);
    }
  });
  it('child tables cascade-key on invoiceId', () => {
    expect(Object.keys(finInvoiceItems)).toContain('invoiceId');
    expect(Object.keys(finPayments)).toContain('invoiceId');
  });
  it('finSources tracks per-org provider config + watermark', () => {
    for (const c of ['orgId', 'provider', 'config', 'secretRefs', 'enabled', 'watermark', 'lastSyncAt'])
      expect(Object.keys(finSources)).toContain(c);
  });
});
