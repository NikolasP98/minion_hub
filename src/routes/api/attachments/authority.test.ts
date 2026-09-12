import { describe, it, expect, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  download: vi.fn(async () => ({ url: 'https://private.invalid/object' })),
}));
vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: async () => ({ tenantId: 'org', profileId: 'user', db: {} }),
}));
vi.mock('$server/services/rbac.service', () => ({
  hasOrgCapability: async () => false,
  ownerFilter: async () => undefined,
}));
vi.mock('$server/services/attachments.service', () => ({
  getAttachmentDownloadUrl: fixture.download,
  ATTACHMENT_OBJECT_MODULE: {
    crm_contact: 'crm',
    booking: 'scheduling',
    event_type: 'scheduling',
    product: 'pos',
    stk_item: 'stock',
    stk_entry: 'stock',
    fin_invoice: 'finance',
    pos_ticket: 'pos',
  },
}));
import { GET } from './[fileId]/+server';
describe('attachment read module authority', () => {
  it('does not disclose or sign an attachment to an org member without any linked-module view', async () => {
    await expect(
      GET({
        locals: { user: { supabaseId: 'user' }, tenantCtx: { tenantId: 'org' } },
        params: { fileId: 'f' },
      } as never),
    ).rejects.toMatchObject({ status: 403 });
    expect(fixture.download).not.toHaveBeenCalled();
  });
});
