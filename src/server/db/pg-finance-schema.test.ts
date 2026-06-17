import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { finInvoices, finInvoiceItems, finPayments, finClients, finSources, finSyncJobs, finProducts } from './pg-finance-schema';

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

describe('finSyncJobs schema', () => {
  it('has the durable job columns', () => {
    const cols = Object.keys(getTableColumns(finSyncJobs));
    for (const c of ['id','orgId','provider','status','total','processed','pageCursor','error','cancelRequested','startedAt','finishedAt','heartbeatAt','createdAt','updatedAt']) {
      expect(cols).toContain(c);
    }
  });
});

describe('catalog + relational FKs', () => {
  it('finProducts has canonical columns', () => {
    const cols = Object.keys(getTableColumns(finProducts));
    for (const c of ['id','orgId','code','name','category','unitPrice','active','metadata','createdAt','updatedAt']) expect(cols).toContain(c);
  });
  it('invoice items carry a product_id FK column', () => {
    const cols = Object.keys(getTableColumns(finInvoiceItems));
    expect(cols).toContain('productId');
  });
  it('invoices carry a client_id FK column', () => {
    const cols = Object.keys(getTableColumns(finInvoices));
    expect(cols).toContain('clientId');
  });
});
