import { describe, it, expect, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

const mockGetCoreDb = vi.fn();
vi.mock('$server/db/pg-client', () => ({ getCoreDb: () => mockGetCoreDb() }));

vi.mock('$server/supabase', () => ({
	supabaseAdmin: vi.fn(() => {
		throw new Error('supabaseAdmin should not be called for a brain-<uuid> agentId');
	}),
}));

import { resolveAssistantPrincipal } from './assistant-principal';
import { requireAssistantCapability } from '../../routes/api/gateway/_shared/action-auth';

const BRAIN_UUID = '11111111-1111-1111-1111-111111111111';
const AGENT_ID = `brain-${BRAIN_UUID}`;

function makeUrl(params: Record<string, string>): URL {
	const url = new URL('https://hub.test/api/gateway/brains');
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	return url;
}

describe('resolveAssistantPrincipal — brain agent (brain-<uuid>)', () => {
	it('resolves a known brain agent to its brain\'s org with brains-only capabilities', async () => {
		const { db, resolveSequence } = createMockDb();
		resolveSequence([[{ orgId: 'org-42' }]]);
		mockGetCoreDb.mockReturnValue(db);

		const locals = { serverId: 'srv-1' } as App.Locals;
		const principal = await resolveAssistantPrincipal(locals, makeUrl({ agentId: AGENT_ID }));

		expect(principal.principalId).toBe(AGENT_ID);
		expect(principal.orgId).toBe('org-42');
		expect(principal.role).toBe('agent');
		expect(principal.capabilities.can('brains', 'view')).toBe(true);
		expect(principal.capabilities.can('brains', 'edit')).toBe(true);
		// Nothing else leaks — including other brains actions and every other module.
		expect(principal.capabilities.can('brains', 'delete')).toBe(false);
		expect(principal.capabilities.can('brains', 'manage')).toBe(false);
		expect(principal.capabilities.can('crm', 'view')).toBe(false);
		expect(principal.capabilities.can('finance', 'view')).toBe(false);
		expect(principal.capabilities.can('comms', 'view')).toBe(false);
		expect(principal.capabilities.canRunAnalytics()).toBe(false);
		expect(principal.capabilities.roles).toEqual([]);
	});

	it('fails closed (400) for an agentId matching the brain-<uuid> shape but no matching brain row', async () => {
		const { db, resolveSequence } = createMockDb();
		resolveSequence([[]]); // no brain has this agent_id
		mockGetCoreDb.mockReturnValue(db);

		const locals = { serverId: 'srv-1' } as App.Locals;
		await expect(
			resolveAssistantPrincipal(locals, makeUrl({ agentId: AGENT_ID })),
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects a non-gateway (browser) caller who is neither admin nor the brain agent itself', async () => {
		const { db, resolveSequence } = createMockDb();
		resolveSequence([[{ orgId: 'org-42' }]]);
		mockGetCoreDb.mockReturnValue(db);

		const locals = {
			user: { id: 'u1', role: 'member', supabaseId: 'some-other-uuid' },
		} as unknown as App.Locals;
		await expect(
			resolveAssistantPrincipal(locals, makeUrl({ agentId: AGENT_ID })),
		).rejects.toMatchObject({ status: 403 });
	});

	it('a brain agent principal is rejected by a non-brains gateway endpoint capability gate', async () => {
		const { db, resolveSequence } = createMockDb();
		resolveSequence([[{ orgId: 'org-42' }]]);
		mockGetCoreDb.mockReturnValue(db);

		const locals = { serverId: 'srv-1' } as App.Locals;
		// requireAssistantCapability is the shared gate every /api/gateway/actions/*
		// and /api/gateway/query/* route uses — e.g. contact-update needs crm:edit.
		await expect(
			requireAssistantCapability(locals, makeUrl({ agentId: AGENT_ID }), 'crm', 'edit'),
		).rejects.toMatchObject({ status: 403 });
	});
});
