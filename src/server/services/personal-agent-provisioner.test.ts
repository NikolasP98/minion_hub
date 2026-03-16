import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	shouldRetryAgent,
	getBackoffDelay,
	getProvisioningPayload,
	getPendingProvisioningForUser,
} from './personal-agent-provisioner';
import type { PersonalAgentRow } from './personal-agent.service';

// Mock the personal-agent.service module
const mockGetPersonalAgent = vi.fn<(ctx: unknown, userId: string) => Promise<PersonalAgentRow | null>>();

vi.mock('./personal-agent.service', () => ({
	getPersonalAgent: (ctx: unknown, userId: string) => mockGetPersonalAgent(ctx, userId),
	updateProvisioningStatus: vi.fn(),
	derivePersonalAgentId: (userId: string) => `personal-${userId}`,
}));

beforeEach(() => {
	vi.clearAllMocks();
});

function makeAgent(overrides: Partial<PersonalAgentRow> = {}): PersonalAgentRow {
	return {
		id: 'pa-1',
		userId: 'user-1',
		agentId: 'personal-user-1',
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
		...overrides,
	};
}

describe('shouldRetryAgent', () => {
	it('returns true for status pending with retryCount 0', () => {
		const agent = makeAgent({ provisioningStatus: 'pending', retryCount: 0 });
		expect(shouldRetryAgent(agent)).toBe(true);
	});

	it('returns true for status error with retryCount < 5', () => {
		const agent = makeAgent({ provisioningStatus: 'error', retryCount: 3 });
		expect(shouldRetryAgent(agent)).toBe(true);
	});

	it('returns false for status error with retryCount >= 5', () => {
		const agent = makeAgent({ provisioningStatus: 'error', retryCount: 5 });
		expect(shouldRetryAgent(agent)).toBe(false);
	});

	it('returns false for status active', () => {
		const agent = makeAgent({ provisioningStatus: 'active' });
		expect(shouldRetryAgent(agent)).toBe(false);
	});

	it('returns false for status provisioning', () => {
		const agent = makeAgent({ provisioningStatus: 'provisioning' });
		expect(shouldRetryAgent(agent)).toBe(false);
	});

	it('respects backoff delay -- returns false if lastRetryAt + backoff > now', () => {
		const now = 1_700_000_010_000;
		// retryCount 0 -> backoff 5000ms, lastRetryAt 3s ago => still within backoff
		const agent = makeAgent({
			provisioningStatus: 'error',
			retryCount: 0,
			lastRetryAt: now - 3_000, // 3s ago, backoff is 5s
		});
		expect(shouldRetryAgent(agent, now)).toBe(false);
	});

	it('allows retry when backoff has elapsed', () => {
		const now = 1_700_000_010_000;
		// retryCount 0 -> backoff 5000ms, lastRetryAt 6s ago => past backoff
		const agent = makeAgent({
			provisioningStatus: 'error',
			retryCount: 0,
			lastRetryAt: now - 6_000, // 6s ago, backoff is 5s
		});
		expect(shouldRetryAgent(agent, now)).toBe(true);
	});

	it('allows retry when lastRetryAt is null (first attempt)', () => {
		const agent = makeAgent({
			provisioningStatus: 'pending',
			retryCount: 0,
			lastRetryAt: null,
		});
		expect(shouldRetryAgent(agent)).toBe(true);
	});
});

describe('getBackoffDelay', () => {
	it('returns 5000 for attempt 0', () => {
		expect(getBackoffDelay(0)).toBe(5_000);
	});

	it('returns 30000 for attempt 1', () => {
		expect(getBackoffDelay(1)).toBe(30_000);
	});

	it('returns 120000 for attempt 2', () => {
		expect(getBackoffDelay(2)).toBe(120_000);
	});

	it('returns 600000 for attempt 3', () => {
		expect(getBackoffDelay(3)).toBe(600_000);
	});

	it('returns 600000 for attempt 4 (capped)', () => {
		expect(getBackoffDelay(4)).toBe(600_000);
	});

	it('returns 600000 for attempt 10 (overflow capped)', () => {
		expect(getBackoffDelay(10)).toBe(600_000);
	});
});

describe('getProvisioningPayload', () => {
	it('returns { name, agentId, agentType: "standard" } for a PersonalAgentRow', () => {
		const agent = makeAgent({
			displayName: "Nikolas's Agent",
			agentId: 'personal-user-1',
		});
		const payload = getProvisioningPayload(agent);
		expect(payload).toEqual({
			name: "Nikolas's Agent",
			agentId: 'personal-user-1',
			agentType: 'standard',
		});
	});

	it('always includes agentType standard', () => {
		const agent = makeAgent();
		expect(getProvisioningPayload(agent).agentType).toBe('standard');
	});
});

describe('getPendingProvisioningForUser', () => {
	it('returns the agent row and payload if user has a pending agent', async () => {
		const pendingAgent = makeAgent({ provisioningStatus: 'pending', retryCount: 0 });
		mockGetPersonalAgent.mockResolvedValue(pendingAgent);

		const result = await getPendingProvisioningForUser({ db: {}, tenantId: 't1' } as never, 'user-1');
		expect(result).not.toBeNull();
		expect(result!.agent).toEqual(pendingAgent);
		expect(result!.payload).toEqual({
			name: "Nikolas's Agent",
			agentId: 'personal-user-1',
			agentType: 'standard',
		});
	});

	it('returns the agent row and payload if user has an error agent with retries left', async () => {
		const errorAgent = makeAgent({ provisioningStatus: 'error', retryCount: 2 });
		mockGetPersonalAgent.mockResolvedValue(errorAgent);

		const result = await getPendingProvisioningForUser({ db: {}, tenantId: 't1' } as never, 'user-1');
		expect(result).not.toBeNull();
		expect(result!.agent).toEqual(errorAgent);
	});

	it('returns null if user has an active agent', async () => {
		const activeAgent = makeAgent({ provisioningStatus: 'active' });
		mockGetPersonalAgent.mockResolvedValue(activeAgent);

		const result = await getPendingProvisioningForUser({ db: {}, tenantId: 't1' } as never, 'user-1');
		expect(result).toBeNull();
	});

	it('returns null if no personal agent exists for user', async () => {
		mockGetPersonalAgent.mockResolvedValue(null);

		const result = await getPendingProvisioningForUser({ db: {}, tenantId: 't1' } as never, 'user-1');
		expect(result).toBeNull();
	});

	it('returns null if agent has exceeded max retries', async () => {
		const exhaustedAgent = makeAgent({ provisioningStatus: 'error', retryCount: 5 });
		mockGetPersonalAgent.mockResolvedValue(exhaustedAgent);

		const result = await getPendingProvisioningForUser({ db: {}, tenantId: 't1' } as never, 'user-1');
		expect(result).toBeNull();
	});
});
