import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockGetTenantCtx = vi.fn<(locals: unknown) => Promise<unknown>>();
vi.mock('$server/auth/tenant-ctx', () => ({
	getTenantCtx: (locals: unknown) => mockGetTenantCtx(locals),
}));

const mockGetPersonalAgent = vi.fn<(ctx: unknown, userId: string) => Promise<unknown>>();
const mockUpdatePersonalAgent = vi.fn<(ctx: unknown, userId: string, updates: unknown) => Promise<void>>();
vi.mock('$server/services/personal-agent.service', () => ({
	getPersonalAgent: (ctx: unknown, userId: string) => mockGetPersonalAgent(ctx, userId),
	updatePersonalAgent: (ctx: unknown, userId: string, updates: unknown) =>
		mockUpdatePersonalAgent(ctx, userId, updates),
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
		const { db } = createMockDb();
		const ctx = { db, tenantId: 'org-1' };
		mockGetTenantCtx.mockResolvedValue(ctx);

		const agentRow = {
			id: 'pa-1',
			userId: 'user-1',
			agentId: 'personal-user-1',
			displayName: "Test User's Agent",
			provisioningStatus: 'active',
		};
		mockGetPersonalAgent.mockResolvedValue(agentRow);

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
		const { db } = createMockDb();
		const ctx = { db, tenantId: 'org-1' };
		mockGetTenantCtx.mockResolvedValue(ctx);
		mockGetPersonalAgent.mockResolvedValue(null);

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

	it('with valid displayName (3 chars) returns { ok: true }', async () => {
		const { db } = createMockDb();
		const ctx = { db, tenantId: 'org-1' };
		mockGetTenantCtx.mockResolvedValue(ctx);
		mockUpdatePersonalAgent.mockResolvedValue(undefined);

		const locals = makeLocals();

		const { PATCH } = await import('./+server');
		const response = await PATCH({
			locals,
			request: makeRequest('PATCH', { displayName: 'Bob' }),
		} as Parameters<typeof PATCH>[0]);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.ok).toBe(true);
		expect(mockUpdatePersonalAgent).toHaveBeenCalledWith(ctx, 'user-1', { displayName: 'Bob' });
	});

	it('rejects displayName longer than 50 chars with 400', async () => {
		const { db } = createMockDb();
		const ctx = { db, tenantId: 'org-1' };
		mockGetTenantCtx.mockResolvedValue(ctx);

		const locals = makeLocals();

		const { PATCH } = await import('./+server');
		const response = await PATCH({
			locals,
			request: makeRequest('PATCH', { displayName: 'A'.repeat(51) }),
		} as Parameters<typeof PATCH>[0]);

		expect(response.status).toBe(400);
	});

	it('rejects displayName shorter than 1 char with 400', async () => {
		const { db } = createMockDb();
		const ctx = { db, tenantId: 'org-1' };
		mockGetTenantCtx.mockResolvedValue(ctx);

		const locals = makeLocals();

		const { PATCH } = await import('./+server');
		const response = await PATCH({
			locals,
			request: makeRequest('PATCH', { displayName: '' }),
		} as Parameters<typeof PATCH>[0]);

		expect(response.status).toBe(400);
	});

	it('rejects personalityText longer than 500 chars with 400', async () => {
		const { db } = createMockDb();
		const ctx = { db, tenantId: 'org-1' };
		mockGetTenantCtx.mockResolvedValue(ctx);

		const locals = makeLocals();

		const { PATCH } = await import('./+server');
		const response = await PATCH({
			locals,
			request: makeRequest('PATCH', { personalityText: 'X'.repeat(501) }),
		} as Parameters<typeof PATCH>[0]);

		expect(response.status).toBe(400);
	});

	it('rejects invalid personalityPreset with 400', async () => {
		const { db } = createMockDb();
		const ctx = { db, tenantId: 'org-1' };
		mockGetTenantCtx.mockResolvedValue(ctx);

		const locals = makeLocals();

		const { PATCH } = await import('./+server');
		const response = await PATCH({
			locals,
			request: makeRequest('PATCH', { personalityPreset: 'invalid-preset' }),
		} as Parameters<typeof PATCH>[0]);

		expect(response.status).toBe(400);
	});

	it('with valid partial update (only personalityText) succeeds', async () => {
		const { db } = createMockDb();
		const ctx = { db, tenantId: 'org-1' };
		mockGetTenantCtx.mockResolvedValue(ctx);
		mockUpdatePersonalAgent.mockResolvedValue(undefined);

		const locals = makeLocals();

		const { PATCH } = await import('./+server');
		const response = await PATCH({
			locals,
			request: makeRequest('PATCH', { personalityText: 'Be helpful and kind' }),
		} as Parameters<typeof PATCH>[0]);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.ok).toBe(true);
		expect(mockUpdatePersonalAgent).toHaveBeenCalledWith(ctx, 'user-1', {
			personalityText: 'Be helpful and kind',
		});
	});
});
