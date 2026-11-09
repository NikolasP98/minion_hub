import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  ctx: { tenantId: 'org', profileId: 'actor' },
  crm: { tenantId: 'org', profileId: 'actor' },
  denied: false,
  owner: vi.fn(),
  mask: vi.fn(),
  prefill: vi.fn(),
  contact: vi.fn(),
}));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: async () => mocks.ctx }));
vi.mock('$server/auth/dataset-ctx', () => ({
  datasetCtx: async (_locals: unknown, module: string) =>
    module === 'crm' && mocks.denied ? { denied: true } : module === 'crm' ? mocks.crm : mocks.ctx,
  isDenied: (ctx: { denied?: boolean }) => ctx.denied === true,
}));
vi.mock('$server/services/rbac.service', () => ({
  ownerFilter: mocks.owner,
  shouldMaskSensitive: mocks.mask,
}));
vi.mock('$server/services/crm-contacts.service', () => ({
  getContactPrefill: mocks.prefill,
  getContact: mocks.contact,
  listTags: async () => [],
}));
vi.mock('$server/services/scheduling.service', () => ({
  listResources: async () => [],
  listEventTypes: async () => [],
  listEventKinds: async () => [],
}));
vi.mock('$lib/components/scheduling/calendar-window', () => ({ schedulingTimeZone: () => 'UTC' }));
import { GET } from '../../routes/api/crm/contacts/[id]/prefill/+server';
import { load } from '../../routes/(app)/scheduling/bookings/new/+page.server';
const locals = {} as App.Locals;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.denied = false;
  mocks.owner.mockResolvedValue('actor');
  mocks.mask.mockResolvedValue(true);
  mocks.prefill.mockResolvedValue({ name: 'Customer', phone: '••••1222', email: '••••alid' });
  mocks.contact.mockResolvedValue({
    contact: { id: 'owned', partyId: 'party', displayName: 'Customer' },
  });
});
describe('CRM form reads use canonical ownership and sensitive-field rules', () => {
  it('prefill API passes both canonical restrictions into the service', async () => {
    const response = await GET({ locals, params: { id: 'owned' } } as never);
    expect(mocks.prefill).toHaveBeenCalledWith(mocks.ctx, 'owned', 'actor', true);
    expect(await response.json()).toEqual({
      name: 'Customer',
      phone: '••••1222',
      email: '••••alid',
    });
  });
  it('prefill API returns404 for a foreign or deleted scoped contact', async () => {
    mocks.prefill.mockResolvedValue(null);
    await expect(GET({ locals, params: { id: 'foreign' } } as never)).rejects.toMatchObject({
      status: 404,
    });
  });
  it('booking preselection scopes both the full contact and prefill calls', async () => {
    const result = await load({
      locals,
      url: new URL('http://localhost/scheduling/bookings/new?contact=owned'),
    } as never);
    expect(mocks.contact).toHaveBeenCalledWith(mocks.crm, 'owned', 'actor', true);
    expect(mocks.prefill).toHaveBeenCalledWith(mocks.crm, 'owned', 'actor', true);
    expect(result).toMatchObject({ scheduling: { contact: { id: 'owned', phone: '••••1222' } } });
  });
  it('booking preselection returns404 rather than serializing a foreign contact fallback', async () => {
    mocks.contact.mockResolvedValue(null);
    await expect(
      load({
        locals,
        url: new URL('http://localhost/scheduling/bookings/new?contact=foreign'),
      } as never),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('booking preselection treats a deleted contact prefill as not found', async () => {
    mocks.prefill.mockResolvedValue(null);
    await expect(
      load({
        locals,
        url: new URL('http://localhost/scheduling/bookings/new?contact=deleted'),
      } as never),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('a scheduling-only caller retains scheduling data without CRM prefill', async () => {
    mocks.denied = true;
    const result = await load({
      locals,
      url: new URL('http://localhost/scheduling/bookings/new?contact=foreign'),
    } as never);
    expect(result).toMatchObject({ scheduling: { contact: null } });
    expect(mocks.contact).not.toHaveBeenCalled();
    expect(mocks.prefill).not.toHaveBeenCalled();
    expect(mocks.owner).not.toHaveBeenCalled();
  });
});
