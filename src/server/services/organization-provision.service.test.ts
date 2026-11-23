import { beforeEach, describe, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  issue: vi.fn(),
  resolve: vi.fn(),
  privateEnv: {} as Record<string, string | undefined>,
  bootstrap: vi.fn(),
  workforce: vi.fn(),
  supabase: vi.fn(),
  publicEnv: {} as Record<string, string | undefined>,
}));
vi.mock('$env/dynamic/private', () => ({ env: f.privateEnv }));
vi.mock('./organization-bootstrap.service', () => ({ bootstrapOrganization: f.bootstrap }));
vi.mock('$lib/server/workforce-fetch', () => ({ workforceClientForOrg: f.workforce }));
vi.mock('$server/supabase', () => ({ supabaseAdmin: f.supabase }));
vi.mock('$env/dynamic/public', () => ({ env: f.publicEnv }));
vi.mock('$server/services/gateway-jwt.service', () => ({
  issueGatewayJwt: f.issue,
  gatewayAudience: (url: string) => `gw:${new URL(url).host}`,
}));
vi.mock('$lib/server/gateway-rpc', () => ({
  gatewayCallAsUser: vi.fn(),
  resolveCredentialsForUser: f.resolve,
}));
vi.mock('$server/db/client', () => ({ getDb: () => ({}) }));

import {
  mintOrgGatewayJwt,
  normalizeOrganizationName,
  organizationSlug,
  provisionOrganization,
} from './organization-provision.service';

describe('organization provision input', () => {
  it('normalizes a stable display name and slug', () => {
    expect(normalizeOrganizationName('  PINONITE   CORP  ')).toBe('PINONITE CORP');
    expect(organizationSlug('Piñonite Corp.')).toBe('pinonite-corp');
  });

  it('rejects blank and non-addressable names', () => {
    expect(() => normalizeOrganizationName(' ')).toThrow('between 2 and 80');
    expect(() => organizationSlug('---')).toThrow('letters or numbers');
  });
});

describe('provisioning gateway JWT audience (spec 045)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete f.publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN;
    f.issue.mockResolvedValue({ token: 'jwt', expiresAt: 0 });
    f.resolve.mockResolvedValue({ url: 'wss://GW.example.test:8443', token: 'shared' });
  });

  it('keeps the legacy audience before launch, which gateways accept with the token', async () => {
    expect(await mintOrgGatewayJwt('org-a', 'profile-1')).toBe('jwt');
    expect(f.issue).toHaveBeenCalledWith(expect.anything(), 'profile-1', { audience: undefined });
    expect(f.resolve).not.toHaveBeenCalled();
  });

  it('after launch binds the JWT to the gateway the provisioning call reaches', async () => {
    f.publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN = 'false';
    await mintOrgGatewayJwt('org-a', 'profile-1');
    expect(f.resolve).toHaveBeenCalledWith('profile-1', 'org-a');
    expect(f.issue).toHaveBeenCalledWith({ db: {}, tenantId: 'org-a' }, 'profile-1', {
      audience: 'gw:gw.example.test:8443',
    });
  });
});

describe('qualified provisioning retry preserves existing access', () => {
  it('never reseeds global Owner when bootstrap returns an existing legacy organization', async () => {
    f.privateEnv.ORG_ROLE_TEMPLATES_ENABLED = 'true';
    f.bootstrap.mockResolvedValue({
      id: '10000000-0000-4000-8000-000000000001',
      name: 'Existing',
      slug: 'existing',
      roleModel: 'legacy',
      created: false,
    });
    f.supabase.mockImplementation(() => {
      throw Error('Legacy access repair must not execute');
    });
    f.workforce.mockRejectedValue(
      Error('External provisioning intentionally unavailable in fixture'),
    );
    try {
      const event = {
        locals: { user: { id: 'owner', supabaseId: '20000000-0000-4000-8000-000000000001' } },
      } as Parameters<typeof provisionOrganization>[0];
      const result = await provisionOrganization(event, {
        name: 'Existing',
        profileId: '20000000-0000-4000-8000-000000000001',
      });
      expect(result.steps.find((s) => s.id === 'membership')?.status).toBe('complete');
      expect(result.steps.find((s) => s.id === 'rbac')?.status).toBe('complete');
      expect(result.steps.find((s) => s.id === 'workforce')?.status).toBe('failed');
      expect(f.supabase).not.toHaveBeenCalled();
    } finally {
      delete f.privateEnv.ORG_ROLE_TEMPLATES_ENABLED;
    }
  });
});

describe('branding creation before external effects', () => {
  const event = {
    locals: { user: { id: 'owner', supabaseId: '20000000-0000-4000-8000-000000000001' } },
  } as Parameters<typeof provisionOrganization>[0];
  beforeEach(() => {
    vi.clearAllMocks();
    delete f.privateEnv.ORG_ROLE_TEMPLATES_ENABLED;
    f.workforce.mockRejectedValue(Error('fixture stop before external effects'));
  });
  it('rejects invalid explicit/null and missing long suggestion before every provisioning effect', async () => {
    for (const params of [
      { name: 'Faces', hubName: 'Faces Hub' },
      { name: 'Faces', hubName: null },
      { name: 'Organization Name Beyond Fifteen' },
    ]) {
      await expect(
        provisionOrganization(event, { profileId: 'p', ...params } as never),
      ).rejects.toThrow();
    }
    expect(f.bootstrap).not.toHaveBeenCalled();
    expect(f.supabase).not.toHaveBeenCalled();
    expect(f.workforce).not.toHaveBeenCalled();
  });
  it('forwards normalized explicit prefix to atomic new-model bootstrap, preserving returned stored retry state', async () => {
    f.privateEnv.ORG_ROLE_TEMPLATES_ENABLED = 'true';
    f.bootstrap.mockResolvedValue({
      id: 'o',
      name: 'Existing',
      slug: 'existing',
      hub_name: 'Original',
      roleModel: 'organization',
      created: false,
    });
    const result = await provisionOrganization(event, {
      name: 'Existing',
      hubName: '  Draft  ',
      profileId: 'p',
    });
    expect(f.bootstrap).toHaveBeenCalledWith(expect.objectContaining({ hubName: 'Draft' }));
    expect(result.organization).toMatchObject({ name: 'Existing', hub_name: 'Original' });
    expect(f.supabase).not.toHaveBeenCalled();
    delete f.privateEnv.ORG_ROLE_TEMPLATES_ENABLED;
  });
  it.each(['create', 'existing', 'race'])(
    'legacy %s writes prefix only in the inserted candidate',
    async (mode) => {
      const inserted: Record<string, unknown>[] = [];
      let lookups = 0;
      const existing = { id: 'o', name: 'Faces', slug: 'faces', hub_name: 'Original' };
      f.supabase.mockImplementation(() => ({
        from: (table: string) => {
          const chain = {
            select: () => chain,
            eq: () => chain,
            maybeSingle: async () => ({
              data: mode === 'existing' || (mode === 'race' && lookups++ > 0) ? existing : null,
              error: null,
            }),
            insert: (candidate: Record<string, unknown>) => {
              inserted.push(candidate);
              return chain;
            },
            single: async () =>
              mode === 'race'
                ? { data: null, error: { code: '23505' } }
                : { data: inserted.at(-1), error: null },
            upsert: async () => ({ error: null }),
          };
          expect(['organizations', 'organization_members', 'member_roles']).toContain(table);
          return chain;
        },
      }));
      const result = await provisionOrganization(event, {
        name: 'Faces',
        hubName: 'New',
        profileId: 'p',
      });
      expect(result.organization).toMatchObject({
        hub_name: mode === 'create' ? 'New' : 'Original',
      });
      expect(inserted).toHaveLength(mode === 'existing' ? 0 : 1);
      if (inserted.length) expect(inserted[0]).toMatchObject({ name: 'Faces', hub_name: 'New' });
    },
  );
});
