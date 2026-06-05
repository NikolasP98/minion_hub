import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockGetTenantCtx = vi.fn<(locals: unknown) => Promise<unknown>>();
vi.mock('$server/auth/tenant-ctx', () => ({
  getTenantCtx: (locals: unknown) => mockGetTenantCtx(locals),
}));

// PATCH resolves the core (Supabase) ctx via getCoreCtx now.
const mockGetCoreCtx = vi.fn<(locals: unknown) => Promise<unknown>>();
vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: (locals: unknown) => mockGetCoreCtx(locals),
}));

const mockGetPersonalAgent = vi.fn<(ctx: unknown, userId: string) => Promise<unknown>>();
const mockUpdatePersonalAgent =
  vi.fn<(ctx: unknown, userId: string, updates: unknown) => Promise<void>>();
const mockLoadPersonalAgentForUser =
  vi.fn<(locals: unknown, userId: string) => Promise<unknown>>();
vi.mock('$server/services/personal-agent.service', () => ({
  getPersonalAgent: (ctx: unknown, userId: string) => mockGetPersonalAgent(ctx, userId),
  updatePersonalAgent: (ctx: unknown, userId: string, updates: unknown) =>
    mockUpdatePersonalAgent(ctx, userId, updates),
  loadPersonalAgentForUser: (locals: unknown, userId: string) =>
    mockLoadPersonalAgentForUser(locals, userId),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeLocals(overrides: Partial<App.Locals> = {}): App.Locals {
  return {
    user: { id: 'user-1', email: 'test@test.com', displayName: 'Test User', role: 'user' },
    session: { userId: 'user-1' } as App.Locals['session'],
    orgId: 'org-1',
    tenantCtx: undefined,
    ...overrides,
  } as App.Locals;
}

function makeRequest(method: string, body?: unknown): Request {
  const init: RequestInit = { method };
  if (body) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  return new Request('http://localhost/api/personal-agent', init);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── GET Tests ────────────────────────────────────────────────────────────────

describe('GET /api/personal-agent', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetTenantCtx.mockResolvedValue(null);
    const locals = makeLocals({ user: undefined });

    const { GET } = await import('./+server');
    const response = await GET({
      locals,
      request: makeRequest('GET'),
    } as Parameters<typeof GET>[0]);

    expect(response.status).toBe(401);
  });

  it('returns { agent: PersonalAgentRow } when authenticated with existing agent', async () => {
    const agentRow = {
      id: 'pa-1',
      userId: 'user-1',
      agentId: 'personal-user-1',
      provisioningStatus: 'active',
    };
    mockLoadPersonalAgentForUser.mockResolvedValue({ agent: agentRow });

    const locals = makeLocals();

    const { GET } = await import('./+server');
    const response = await GET({
      locals,
      request: makeRequest('GET'),
    } as Parameters<typeof GET>[0]);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.agent).toEqual(agentRow);
  });

  it('returns { agent: null } when authenticated but no agent exists', async () => {
    mockLoadPersonalAgentForUser.mockResolvedValue({ agent: null });

    const locals = makeLocals();

    const { GET } = await import('./+server');
    const response = await GET({
      locals,
      request: makeRequest('GET'),
    } as Parameters<typeof GET>[0]);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.agent).toBeNull();
  });
});

// ── PATCH Tests ──────────────────────────────────────────────────────────────

describe('PATCH /api/personal-agent', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetTenantCtx.mockResolvedValue(null);
    const locals = makeLocals({ user: undefined });

    const { PATCH } = await import('./+server');
    const response = await PATCH({
      locals,
      request: makeRequest('PATCH', { displayName: 'New Name' }),
    } as Parameters<typeof PATCH>[0]);

    expect(response.status).toBe(401);
  });

  it('silently ignores deprecated fields (displayName, personality*, conversationName)', async () => {
    const { db } = createMockDb();
    const ctx = { db, tenantId: 'org-1' };
    mockGetCoreCtx.mockResolvedValue(ctx);
    mockUpdatePersonalAgent.mockResolvedValue(undefined);

    const locals = makeLocals();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { PATCH } = await import('./+server');
    const response = await PATCH({
      locals,
      request: makeRequest('PATCH', {
        displayName: 'Bob',
        conversationName: 'PANIK',
        personalityText: 'Be chill',
        personalityPreset: 'casual',
        personalityConfigured: true,
        avatarUrl: 'https://example.com/a.png',
      }),
    } as Parameters<typeof PATCH>[0]);

    expect(response.status).toBe(200);
    // All deprecated fields dropped; only avatarUrl makes it through.
    expect(mockUpdatePersonalAgent).toHaveBeenCalledWith(ctx, 'user-1', {
      avatarUrl: 'https://example.com/a.png',
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('with valid partial update (only avatarUrl) succeeds', async () => {
    const { db } = createMockDb();
    const ctx = { db, tenantId: 'org-1' };
    mockGetCoreCtx.mockResolvedValue(ctx);
    mockUpdatePersonalAgent.mockResolvedValue(undefined);

    const locals = makeLocals();

    const { PATCH } = await import('./+server');
    const response = await PATCH({
      locals,
      request: makeRequest('PATCH', { avatarUrl: 'https://example.com/avatar.png' }),
    } as Parameters<typeof PATCH>[0]);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(mockUpdatePersonalAgent).toHaveBeenCalledWith(ctx, 'user-1', {
      avatarUrl: 'https://example.com/avatar.png',
    });
  });
});
