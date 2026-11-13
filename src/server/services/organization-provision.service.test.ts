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
