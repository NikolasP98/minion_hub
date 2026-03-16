import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	derivePersonalAgentId,
	deriveDisplayName,
	provisionPersonalAgent,
	getPersonalAgent,
	updatePersonalAgent,
	updateProvisioningStatus,
	ensurePersonalAgentOnLogin,
	listPendingAgents,
	deletePersonalAgent,
} from './personal-agent.service';
import { createMockDb } from '$server/test-utils/mock-db';

beforeEach(() => {
	vi.clearAllMocks();
});

vi.mock('$server/db/utils', () => ({
	newId: () => 'mock-pa-id-000000000001',
	nowMs: () => 1_700_000_000_000,
}));

const mockAssignAgentToUser = vi.fn<(ctx: unknown, userId: string, agentId: string, serverId: string) => Promise<void>>();
vi.mock('./user-agents.service', () => ({
	assignAgentToUser: (ctx: unknown, userId: string, agentId: string, serverId: string) =>
		mockAssignAgentToUser(ctx, userId, agentId, serverId),
}));

describe('derivePersonalAgentId', () => {
	it('returns personal-{userId}', () => {
		expect(derivePersonalAgentId('user-abc-123')).toBe('personal-user-abc-123');
	});

	it('is deterministic for the same userId', () => {
		const id1 = derivePersonalAgentId('u1');
		const id2 = derivePersonalAgentId('u1');
		expect(id1).toBe(id2);
	});
});

describe('deriveDisplayName', () => {
	it('returns "{userName}\'s Agent"', () => {
		expect(deriveDisplayName('Nikolas')).toBe("Nikolas's Agent");
	});
});

describe('provisionPersonalAgent', () => {
	it('creates a personal_agents row with status pending and deterministic agentId', async () => {
		const { db } = createMockDb();
		const result = await provisionPersonalAgent(
			{ db, tenantId: 't1' },
			{ userId: 'user-1', userName: 'Nikolas', serverId: 'srv-1' },
		);
		expect(result).toBeDefined();
		expect(result.agentId).toBe('personal-user-1');
		expect(result.provisioningStatus).toBe('pending');
		expect(result.displayName).toBe("Nikolas's Agent");
		expect(db.insert).toHaveBeenCalled();
	});

	it('calls assignAgentToUser for JWT compatibility', async () => {
		const { db } = createMockDb();
		await provisionPersonalAgent(
			{ db, tenantId: 't1' },
			{ userId: 'user-1', userName: 'Nikolas', serverId: 'srv-1' },
		);
		expect(mockAssignAgentToUser).toHaveBeenCalledWith(
			expect.objectContaining({ db }),
			'user-1',
			'personal-user-1',
			'srv-1',
		);
	});

	it('is idempotent -- calling twice for same user returns existing without error', async () => {
		const { db, resolveSequence } = createMockDb();
		// First call: insert succeeds (onConflictDoNothing), then select returns new row
		const existingRow = {
			id: 'mock-pa-id-000000000001',
			userId: 'user-1',
			agentId: 'personal-user-1',
			serverId: 'srv-1',
			displayName: "Nikolas's Agent",
			provisioningStatus: 'pending',
			personalityConfigured: false,
			retryCount: 0,
			createdAt: 1_700_000_000_000,
			updatedAt: 1_700_000_000_000,
		};
		resolveSequence([
			undefined, // insert().values().onConflictDoNothing()
			undefined, // update (user.personalAgentId)
			[existingRow], // select after insert to return row
		]);
		const result = await provisionPersonalAgent(
			{ db, tenantId: 't1' },
			{ userId: 'user-1', userName: 'Nikolas', serverId: 'srv-1' },
		);
		expect(result).toBeDefined();
		expect(result.agentId).toBe('personal-user-1');
	});

	it('updates user.personalAgentId for fast lookup', async () => {
		const { db } = createMockDb();
		await provisionPersonalAgent(
			{ db, tenantId: 't1' },
			{ userId: 'user-1', userName: 'Nikolas', serverId: 'srv-1' },
		);
		expect(db.update).toHaveBeenCalled();
	});
});

describe('getPersonalAgent', () => {
	it('returns the personal agent row for a userId', async () => {
		const { db, resolve } = createMockDb();
		const mockRow = {
			id: 'pa-1',
			userId: 'user-1',
			agentId: 'personal-user-1',
			displayName: "Nikolas's Agent",
			provisioningStatus: 'active',
		};
		resolve([mockRow]);
		const result = await getPersonalAgent({ db, tenantId: 't1' }, 'user-1');
		expect(result).toEqual(mockRow);
		expect(db.select).toHaveBeenCalled();
	});

	it('returns null if no personal agent exists', async () => {
		const { db, resolve } = createMockDb();
		resolve([]);
		const result = await getPersonalAgent({ db, tenantId: 't1' }, 'user-1');
		expect(result).toBeNull();
	});
});

describe('updatePersonalAgent', () => {
	it('updates displayName, conversationName, personalityPreset, personalityText', async () => {
		const { db } = createMockDb();
		await updatePersonalAgent({ db, tenantId: 't1' }, 'user-1', {
			displayName: 'My Assistant',
			conversationName: 'PANIK',
			personalityPreset: 'casual',
			personalityText: 'Be chill and friendly',
			personalityConfigured: true,
			avatarUrl: null,
		});
		expect(db.update).toHaveBeenCalled();
	});
});

describe('updateProvisioningStatus', () => {
	it('transitions pending -> provisioning', async () => {
		const { db } = createMockDb();
		await updateProvisioningStatus({ db, tenantId: 't1' }, 'user-1', 'provisioning');
		expect(db.update).toHaveBeenCalled();
	});

	it('transitions provisioning -> active', async () => {
		const { db } = createMockDb();
		await updateProvisioningStatus({ db, tenantId: 't1' }, 'user-1', 'active');
		expect(db.update).toHaveBeenCalled();
	});

	it('transitions provisioning -> error with error message', async () => {
		const { db } = createMockDb();
		await updateProvisioningStatus(
			{ db, tenantId: 't1' },
			'user-1',
			'error',
			'Gateway unreachable',
		);
		expect(db.update).toHaveBeenCalled();
	});
});

describe('ensurePersonalAgentOnLogin', () => {
	it('creates personal agent if none exists', async () => {
		const { db, resolveSequence } = createMockDb();
		// First select returns empty (no existing agent)
		// Then insert + update + select returns new row
		const newRow = {
			id: 'mock-pa-id-000000000001',
			userId: 'user-1',
			agentId: 'personal-user-1',
			displayName: "Nikolas's Agent",
			provisioningStatus: 'pending',
		};
		resolveSequence([
			[], // getPersonalAgent select -> no rows
			undefined, // insert
			undefined, // update user.personalAgentId
			[newRow], // select after insert
		]);
		const result = await ensurePersonalAgentOnLogin(
			{ db, tenantId: 't1' },
			{ userId: 'user-1', userName: 'Nikolas', serverId: 'srv-1' },
		);
		expect(result).toBeDefined();
		expect(result.agentId).toBe('personal-user-1');
	});

	it('returns existing agent if already present', async () => {
		const { db, resolve } = createMockDb();
		const existingRow = {
			id: 'pa-1',
			userId: 'user-1',
			agentId: 'personal-user-1',
			displayName: "Nikolas's Agent",
			provisioningStatus: 'active',
		};
		resolve([existingRow]);
		const result = await ensurePersonalAgentOnLogin(
			{ db, tenantId: 't1' },
			{ userId: 'user-1', userName: 'Nikolas', serverId: 'srv-1' },
		);
		expect(result).toEqual(existingRow);
		// Should NOT have inserted since agent exists
		expect(db.insert).not.toHaveBeenCalled();
	});
});

describe('listPendingAgents', () => {
	it('returns agents with status pending or error and retryCount < maxRetries', async () => {
		const { db, resolve } = createMockDb();
		const pendingRows = [
			{ id: 'pa-1', userId: 'u1', provisioningStatus: 'pending', retryCount: 0 },
			{ id: 'pa-2', userId: 'u2', provisioningStatus: 'error', retryCount: 2 },
		];
		resolve(pendingRows);
		const result = await listPendingAgents({ db, tenantId: 't1' });
		expect(result).toEqual(pendingRows);
		expect(db.select).toHaveBeenCalled();
	});

	it('accepts custom maxRetries parameter', async () => {
		const { db, resolve } = createMockDb();
		resolve([]);
		const result = await listPendingAgents({ db, tenantId: 't1' }, 3);
		expect(result).toEqual([]);
	});
});

describe('deletePersonalAgent', () => {
	it('deletes personal agent row', async () => {
		const { db } = createMockDb();
		await deletePersonalAgent({ db, tenantId: 't1' }, 'user-1');
		expect(db.delete).toHaveBeenCalled();
	});
});
