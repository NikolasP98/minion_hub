import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  installBaseModules: vi.fn(),
  workforceClientForOrg: vi.fn(),
  orgKind: 'personal' as string | null,
}));

// Minimal supabase-js chain: every builder method returns the builder, which
// awaits to `{ error: null }`; the two row reads answer per table.
function table(name: string) {
  let selected = '';
  const builder: Record<string, unknown> = {
    select: (cols: string) => ((selected = cols), builder),
    eq: () => builder,
    insert: () => builder,
    upsert: () => builder,
    maybeSingle: async () => ({
      data: name === 'organizations' && selected === 'kind' ? { kind: mocks.orgKind } : null,
      error: null,
    }),
    single: async () => ({
      data: { id: 'org-1', name: 'Clinica Norte', slug: 'clinica-norte' },
      error: null,
    }),
    then: (resolve: (v: unknown) => void) => resolve({ error: null }),
  };
  return builder;
}

vi.mock('$server/supabase', () => ({ supabaseAdmin: () => ({ from: table }) }));
vi.mock('$lib/server/workforce-fetch', () => ({
  workforceClientForOrg: (...args: unknown[]) => mocks.workforceClientForOrg(...args),
}));
vi.mock('$server/services/gateway.pg.service', () => ({ ensureDefaultGatewayForUser: vi.fn() }));
vi.mock('$lib/server/gateway-rpc', () => ({ gatewayCallAsUser: vi.fn() }));
vi.mock('$server/services/gateway-jwt.service', () => ({ issueGatewayJwt: vi.fn() }));
vi.mock('$server/db/client', () => ({ getDb: () => ({}) }));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: () => ({ core: true }) }));
vi.mock('$server/services/module-install.service', () => ({
  installBaseModules: (...args: unknown[]) => mocks.installBaseModules(...args),
}));

import { provisionOrganization } from './organization-provision.service';

const event = { locals: { user: { id: 'u-1', supabaseId: 'profile-1' } } } as never;
const run = () => provisionOrganization(event, { name: 'Clinica Norte', profileId: 'profile-1' });
const statuses = (steps: { id: string; status: string }[]) =>
  steps.map((s) => `${s.id}:${s.status}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.orgKind = 'personal';
  mocks.installBaseModules.mockResolvedValue({ rowsWritten: 8, landingSet: true });
  // Stop at workforce so the gateway steps never run.
  mocks.workforceClientForOrg.mockRejectedValue(new Error('workforce down'));
});

describe('provisionOrganization — modules step (spec 047 S4)', () => {
  it('installs the base modules after rbac and before workforce, with the org kind', async () => {
    const result = await run();
    expect(statuses(result.steps)).toEqual([
      'organization:complete',
      'membership:complete',
      'rbac:complete',
      'modules:complete',
      'workforce:failed',
      'gateway:skipped',
      'workstation:skipped',
      'readiness:skipped',
    ]);
    expect(mocks.installBaseModules).toHaveBeenCalledWith(
      { db: { core: true }, tenantId: 'org-1', profileId: 'profile-1' },
      'personal',
    );
  });

  it('defaults a missing kind to business', async () => {
    mocks.orgKind = null;
    await run();
    expect(mocks.installBaseModules).toHaveBeenCalledWith(expect.anything(), 'business');
  });

  it('a failed install skips every later step', async () => {
    mocks.installBaseModules.mockRejectedValue(new Error('db down'));
    const result = await run();
    expect(statuses(result.steps).slice(3)).toEqual([
      'modules:failed',
      'workforce:skipped',
      'gateway:skipped',
      'workstation:skipped',
      'readiness:skipped',
    ]);
    expect(mocks.workforceClientForOrg).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });
});
