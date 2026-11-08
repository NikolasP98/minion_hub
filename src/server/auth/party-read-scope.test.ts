import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ modules: new Set<string>(), owner: vi.fn(), mask: vi.fn() }));
vi.mock('$server/services/rbac.service', async (original) => ({
  ...(await original<typeof import('$server/services/rbac.service')>()),
  hasOrgCapability: async (_locals: unknown, module: string) => mocks.modules.has(module),
  ownerFilter: mocks.owner,
  shouldMaskSensitive: mocks.mask,
}));
import { partyReadScope } from './party-read-scope';
const locals = {} as App.Locals;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.modules = new Set(['crm']);
  mocks.owner.mockResolvedValue('actor');
  mocks.mask.mockResolvedValue(true);
});
describe('shared-party read authority projection', () => {
  it('CRM-only own/masked callers require an owned facet', async () => {
    expect(await partyReadScope(locals)).toEqual({
      ownerId: 'actor',
      maskSensitive: true,
      allowUnlinked: false,
    });
  });
  it.each(['pos', 'scheduling', 'stock', 'finance', 'sales', 'support', 'memberships'])(
    'retains unlinked parties for a legitimate %s consumer',
    async (module) => {
      mocks.modules.add(module);
      expect(await partyReadScope(locals)).toMatchObject({
        ownerId: 'actor',
        maskSensitive: true,
        allowUnlinked: true,
      });
    },
  );
  it.each(['brains', 'pulse', 'ads', 'projects', 'comms'])(
    'unrelated %s access does not unlock unlinked customer or supplier parties',
    async (module) => {
      mocks.modules.add(module);
      expect(await partyReadScope(locals)).toEqual({
        ownerId: 'actor',
        maskSensitive: true,
        allowUnlinked: false,
      });
    },
  );
  it('does not reinterpret a CRM-denied customer/supplier consumer as CRM-own', async () => {
    mocks.modules = new Set(['pos']);
    expect(await partyReadScope(locals)).toEqual({});
    expect(mocks.owner).not.toHaveBeenCalled();
    expect(mocks.mask).not.toHaveBeenCalled();
  });
  it('unrestricted CRM users retain the ordinary read projection', async () => {
    mocks.owner.mockResolvedValue(undefined);
    mocks.mask.mockResolvedValue(false);
    expect(await partyReadScope(locals)).toEqual({});
  });
});
