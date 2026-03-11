import { sendRequest } from '$lib/services/gateway.svelte';
import { toastError, toastInfo } from '$lib/state/ui/toast.svelte';

// ── Types ──────────────────────────────────────────────────────

export type SubagentEntry = {
	key: string;
	label: string | null;
	template: string | null;
	model: string | null;
	orchestrationId: string | null;
	spawnDepth: number;
	status: 'running' | 'completed' | 'failed';
	inputTokens: number;
	outputTokens: number;
	spawnedBy: string | null;
	startedAt: number | null;
	completedAt: number | null;
	resultText: string | null;
};

export type OrchestrationEntry = {
	orchestrationId: string;
	mode: string;
	status: string;
	taskCount: number;
	startedAt: number;
	completedAt?: number;
};

export type TemplateEntry = {
	name: string;
	description?: string;
	icon?: string | null;
	color?: string | null;
	tags: string[];
	model: string | null;
	source: string;
	version?: string;
	spawnCount: number;
	lastUsedAt: number | null;
};

// ── State ──────────────────────────────────────────────────────

export const piAgentState = $state({
	agentId: null as string | null,
	loading: false,
	error: null as string | null,

	// Context usage (from pi-agent.context-usage)
	contextUsage: null as {
		tokenCount: number | null;
		contextWindow: number | null;
		percent: number | null;
		messageCount: number;
		compactionCount: number;
	} | null,

	// Session stats (from pi-agent.session-stats)
	sessionStats: null as {
		inputTokens: number;
		outputTokens: number;
		totalTokens: number;
		turnCount: number;
		toolCallCount: number;
	} | null,

	// Thinking (from pi-agent.thinking.levels)
	thinkingLevels: [] as string[],
	currentThinkingLevel: null as string | null,

	// Subagents (from pi-agent.subagents.list via Plan 01)
	subagents: [] as SubagentEntry[],

	// Orchestrations (from pi-agent.orchestrations.list)
	orchestrations: [] as OrchestrationEntry[],

	// Templates (from templates.list)
	templates: [] as TemplateEntry[]
});

// ── Actions ────────────────────────────────────────────────────

export async function loadPiAgentData(agentId: string) {
	piAgentState.agentId = agentId;
	piAgentState.loading = true;
	piAgentState.error = null;

	const sessionKey = `agent:${agentId}:main`;

	try {
		const results = await Promise.allSettled([
			sendRequest('pi-agent.context-usage', { key: sessionKey }),
			sendRequest('pi-agent.session-stats', { key: sessionKey }),
			sendRequest('pi-agent.thinking.levels', { key: sessionKey }),
			sendRequest('pi-agent.subagents.list', { agentId }),
			sendRequest('pi-agent.orchestrations.list', { agentId }),
			sendRequest('templates.list', {})
		]);

		// Context usage
		if (results[0].status === 'fulfilled' && results[0].value) {
			const r = results[0].value as {
				tokenCount?: number | null;
				contextWindow?: number | null;
				percent?: number | null;
				messageCount?: number;
				compactionCount?: number;
			};
			piAgentState.contextUsage = {
				tokenCount: r.tokenCount ?? null,
				contextWindow: r.contextWindow ?? null,
				percent: r.percent ?? null,
				messageCount: r.messageCount ?? 0,
				compactionCount: r.compactionCount ?? 0
			};
		}

		// Session stats
		if (results[1].status === 'fulfilled' && results[1].value) {
			const r = results[1].value as {
				inputTokens?: number;
				outputTokens?: number;
				totalTokens?: number;
				turnCount?: number;
				toolCallCount?: number;
			};
			piAgentState.sessionStats = {
				inputTokens: r.inputTokens ?? 0,
				outputTokens: r.outputTokens ?? 0,
				totalTokens: r.totalTokens ?? 0,
				turnCount: r.turnCount ?? 0,
				toolCallCount: r.toolCallCount ?? 0
			};
		}

		// Thinking levels
		if (results[2].status === 'fulfilled' && results[2].value) {
			const r = results[2].value as { levels?: string[]; currentLevel?: string | null };
			piAgentState.thinkingLevels = r.levels ?? [];
			piAgentState.currentThinkingLevel = r.currentLevel ?? null;
		}

		// Subagents
		if (results[3].status === 'fulfilled' && results[3].value) {
			const r = results[3].value as { subagents?: SubagentEntry[] };
			piAgentState.subagents = r.subagents ?? [];
		}

		// Orchestrations
		if (results[4].status === 'fulfilled' && results[4].value) {
			const r = results[4].value as { orchestrations?: OrchestrationEntry[] };
			piAgentState.orchestrations = r.orchestrations ?? [];
		}

		// Templates
		if (results[5].status === 'fulfilled' && results[5].value) {
			const r = results[5].value as { templates?: TemplateEntry[] };
			piAgentState.templates = r.templates ?? [];
		}

		// Check if any critical requests failed
		const failures = results.filter((r) => r.status === 'rejected');
		if (failures.length === results.length) {
			piAgentState.error = 'All data requests failed';
		}
	} catch (e) {
		piAgentState.error = e instanceof Error ? e.message : 'Failed to load pi-agent data';
	} finally {
		piAgentState.loading = false;
	}
}

export function refreshPiAgentData() {
	if (piAgentState.agentId) {
		loadPiAgentData(piAgentState.agentId);
	}
}

export function clearPiAgentData() {
	piAgentState.agentId = null;
	piAgentState.loading = false;
	piAgentState.error = null;
	piAgentState.contextUsage = null;
	piAgentState.sessionStats = null;
	piAgentState.thinkingLevels = [];
	piAgentState.currentThinkingLevel = null;
	piAgentState.subagents = [];
	piAgentState.orchestrations = [];
	piAgentState.templates = [];
}

export async function setThinkingLevel(level: string) {
	if (!piAgentState.agentId) return;

	const sessionKey = `agent:${piAgentState.agentId}:main`;
	try {
		await sendRequest('pi-agent.thinking.set', { key: sessionKey, level });
		piAgentState.currentThinkingLevel = level;
	} catch (e) {
		toastError('Failed to set thinking level', e instanceof Error ? e.message : String(e));
	}
}

export async function killSubagent(key: string) {
	try {
		await sendRequest('pi-agent.subagents.kill', { key });
		toastInfo('Subagent killed');
	} catch (e) {
		toastError('Failed to kill subagent', e instanceof Error ? e.message : String(e));
	}
	refreshPiAgentData();
}

export async function steerSubagent(key: string, message: string) {
	try {
		await sendRequest('pi-agent.subagents.steer', { key, message });
		toastInfo('Message sent');
	} catch (e) {
		toastError('Failed to steer subagent', e instanceof Error ? e.message : String(e));
	}
}
