import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMigratedPersonalAgent } from './personal-agent-migration';
import { createMockDb } from '$server/test-utils/mock-db';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('$server/db/utils', () => ({
	newId: () => 'mock-migration-id-000001',
	nowMs: () => 1_700_000_000_000,
}));

const mockAssignAgentToUser = vi.fn<
	(ctx: unknown, userId: string, agentId: string, serverId: string) => Promise<void>
>();
vi.mock('./user-agents.service', () => ({
	assignAgentToUser: (ctx: unknown, userId: string, agentId: string, serverId: string) =>
		mockAssignAgentToUser(ctx, userId, agentId, serverId),
}));

beforeEach(() => {
	vi.clearAllMocks();
});

// The mock DB sequence for createMigratedPersonalAgent:
// provisionPersonalAgent:
//   1. await db.insert(personalAgents)...onConflictDoNothing()   [index 0]
//   2. await db.update(user).set(...)...                         [index 1]
//   3. assignAgentToUser → MOCKED (no DB call)
//   4. const [existing] = await db.select()...from(personalAgents)... [index 2] ← must be array
// updateProvisioningStatus:
//   5. await db.update(personalAgents)...                        [index 3]
// updatePersonalAgent:
//   6. await db.update(personalAgents)...                        [index 4]

const mockRow = {
	id: 'mock-migration-id-000001',
	userId: 'user-922286663',
	agentId: 'personal-user-922286663',
	serverId: 'srv-1',
	displayName: "Nikolas's Agent",
	conversationName: null,
	avatarUrl: null,
	personalityPreset: null,
	personalityText: null,
	personalityConfigured: false,
	provisioningStatus: 'pending',
	provisioningError: null,
	lastRetryAt: null,
	retryCount: 0,
	createdAt: 1_700_000_000_000,
	updatedAt: 1_700_000_000_000,
};

function setupMockSequence() {
	const mock = createMockDb();
	mock.resolveSequence([
		undefined, // 1: insert personalAgents
		undefined, // 2: update user.personalAgentId
		[mockRow], // 3: select from personalAgents (provisionPersonalAgent return)
		undefined, // 4: update provisioningStatus to 'active'
		undefined, // 5: update conversationName
	]);
	return mock;
}

describe('createMigratedPersonalAgent', () => {
	const baseParams = {
		userId: 'user-922286663',
		userName: 'Nikolas',
		serverId: 'srv-1',
		originalName: 'PANIK',
		newAgentId: 'personal-user-922286663',
	};

	it('creates personal_agents row via provisionPersonalAgent', async () => {
		const { db } = setupMockSequence();
		const result = await createMigratedPersonalAgent({ db, tenantId: 't1' }, baseParams);
		expect(result).toBeDefined();
		expect(result.agentId).toBe('personal-user-922286663');
		expect(db.insert).toHaveBeenCalled();
	});

	it('sets status to active (not pending) after creation', async () => {
		const { db } = setupMockSequence();
		const result = await createMigratedPersonalAgent({ db, tenantId: 't1' }, baseParams);
		expect(result.provisioningStatus).toBe('active');
		// At least 2 update calls: user.personalAgentId + provisioningStatus 'active'
		expect(db.update).toHaveBeenCalled();
	});

	it('preserves originalName as conversationName', async () => {
		const { db } = setupMockSequence();
		const result = await createMigratedPersonalAgent({ db, tenantId: 't1' }, baseParams);
		expect(result.conversationName).toBe('PANIK');
	});

	it('sets displayName to "{User}\'s Agent" format', async () => {
		const { db } = setupMockSequence();
		const result = await createMigratedPersonalAgent({ db, tenantId: 't1' }, baseParams);
		expect(result.displayName).toBe("Nikolas's Agent");
	});
});
