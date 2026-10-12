import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  organizations: vi.fn(),
  coreCtx: vi.fn(),
  finSettings: vi.fn(),
}));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: vi.fn() }));
vi.mock('$server/db/client', () => ({ getDb: vi.fn() }));
vi.mock('$server/supabase', () => ({ supabaseAdmin: vi.fn() }));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: mocks.coreCtx }));
vi.mock('$server/services/organizations.service', () => ({
  loadOrganizationsForUser: mocks.organizations,
}));
vi.mock('$server/services/finance.service', () => ({
  getFinSettings: mocks.finSettings,
  updateFinSettings: vi.fn(),
}));
vi.mock('$server/services/rbac.service', () => ({ requireOrgCapability: vi.fn() }));
vi.mock('$server/services/supabase-credential', () => ({ updateSupabaseProfile: vi.fn() }));
vi.mock('$server/services/user-preferences.service', () => ({ upsertUserPreference: vi.fn() }));
vi.mock('$server/landing-cache', () => ({ invalidateLandingCache: vi.fn() }));

import { load } from './+page.server';

const ORG = { id: 'org-1', name: 'Acme', slug: 'acme', kind: 'business' as const, role: 'owner' };

function event(user: Record<string, unknown>) {
  return {
    locals: {
      user: { id: 'u1', supabaseId: 'p1', email: 'u@example.test', role: 'user', ...user },
    },
  } as Parameters<typeof load>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.coreCtx.mockResolvedValue({ db: {}, tenantId: ORG.id });
  mocks.finSettings.mockResolvedValue({ timezone: 'America/Lima', currency: 'PEN' });
});

it('sends a user with no organization to enrollment', async () => {
  mocks.organizations.mockResolvedValue({ organizations: [], activeOrgId: null });
  await expect(load(event({ onboardedAt: null }))).rejects.toMatchObject({
    status: 303,
    location: '/join',
  });
});

it('serves the org flow first when the active org has never been set up', async () => {
  mocks.organizations.mockResolvedValue({
    organizations: [{ ...ORG, onboardedAt: null }],
    activeOrgId: ORG.id,
  });
  await expect(load(event({ onboardedAt: null }))).resolves.toMatchObject({
    scope: 'org',
    org: { name: 'Acme', kind: 'business', timezone: 'America/Lima', currency: 'PEN' },
  });
});

it('serves the user flow once the org is set up', async () => {
  mocks.organizations.mockResolvedValue({
    organizations: [{ ...ORG, onboardedAt: '2026-01-01T00:00:00.000Z' }],
    activeOrgId: ORG.id,
  });
  await expect(load(event({ onboardedAt: null, displayName: 'Nikolas' }))).resolves.toMatchObject({
    scope: 'user',
    user: { displayName: 'Nikolas' },
  });
  expect(mocks.finSettings).not.toHaveBeenCalled();
});

it('redirects away when there is nothing left to set up', async () => {
  mocks.organizations.mockResolvedValue({
    organizations: [{ ...ORG, onboardedAt: '2026-01-01T00:00:00.000Z' }],
    activeOrgId: ORG.id,
  });
  await expect(load(event({ onboardedAt: '2026-01-02T00:00:00.000Z' }))).rejects.toMatchObject({
    status: 303,
    location: '/',
  });
});

it('does not hold a plain member at the org flow it cannot submit', async () => {
  mocks.organizations.mockResolvedValue({
    organizations: [{ ...ORG, role: 'member', onboardedAt: null }],
    activeOrgId: ORG.id,
  });
  await expect(load(event({ onboardedAt: '2026-01-02T00:00:00.000Z' }))).rejects.toMatchObject({
    status: 303,
    location: '/',
  });
});
