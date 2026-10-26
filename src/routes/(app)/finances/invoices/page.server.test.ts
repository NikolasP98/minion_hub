import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Spec 039 S4: invoices read through the finance handle; the contact name through the CRM handle. */
const h = vi.hoisted(() => ({
  denied: new Set<string>(),
  listInvoices: vi.fn(() => Promise.resolve({ rows: [{ id: 'inv1' }], total: 1 })),
  getContact: vi.fn(() => Promise.resolve({ contact: { displayName: 'Ana' } })),
}));
vi.mock('$server/auth/dataset-ctx', () => ({
  datasetCtx: (_l: unknown, module: string) =>
    Promise.resolve(
      h.denied.has(module) ? { denied: module, verb: 'view' } : { tenantId: 'org-1', module },
    ),
  isDenied: (v: unknown) => !!v && typeof v === 'object' && 'denied' in v,
}));
vi.mock('$server/services/finance.service', () => ({ listInvoices: h.listInvoices }));
vi.mock('$server/services/crm-contacts.service', () => ({ getContact: h.getContact }));
vi.mock('$server/services/custom-property-bundle.service', () => ({
  loadCustomPropertyBundle: () => Promise.resolve({}),
}));

async function call() {
  const { load } = await import('./+page.server');
  const out = await load({
    locals: {},
    depends: () => {},
    url: new URL('http://x/finances/invoices?contact=c1'),
  } as unknown as Parameters<typeof load>[0]);
  return (out as { finance: Record<string, unknown> }).finance;
}

beforeEach(() => {
  h.denied.clear();
  vi.clearAllMocks();
});

describe('/finances/invoices +page.server load', () => {
  it('finance denied: the slot is the marker and no finance service runs', async () => {
    h.denied.add('finance');
    expect(await call()).toEqual({ denied: 'finance', verb: 'view' });
    expect(h.listInvoices).not.toHaveBeenCalled();
    expect(h.getContact).not.toHaveBeenCalled();
  });

  it('crm denied: invoices load, the contact name is withheld', async () => {
    h.denied.add('crm');
    const fin = await call();
    expect(fin.invoices).toEqual([{ id: 'inv1' }]);
    expect(fin.contactName).toBeNull();
    expect(h.getContact).not.toHaveBeenCalled();
  });

  it('all allowed: the name comes through the crm handle', async () => {
    const fin = await call();
    expect(fin.contactName).toBe('Ana');
    expect(h.getContact).toHaveBeenCalledWith(expect.objectContaining({ module: 'crm' }), 'c1');
  });
});
