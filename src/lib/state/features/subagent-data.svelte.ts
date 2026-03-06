import { sendRequest } from '$lib/services/gateway.svelte';

// ── Types ──────────────────────────────────────────────────────

export interface SubagentSession {
	key: string;
	label?: string;
	displayName?: string;
	model?: string;
	modelProvider?: string;
	spawnedBy?: string;
	spawnDepth?: number;
	updatedAt: number | null;
	sessionId?: string;
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
	totalTokensFresh?: boolean;
	abortedLastRun?: boolean;
	channel?: string;
}

type SubagentStatus = 'running' | 'completed' | 'failed' | 'unknown';

// ── State ──────────────────────────────────────────────────────

export const subagentState = $state({
	agentId: null as string | null,
	sessions: [] as SubagentSession[],
	selectedKey: null as string | null,
	loading: false,
	error: null as string | null
});

// ── Derived ────────────────────────────────────────────────────

export function getSelectedSubagent(): SubagentSession | null {
	return subagentState.sessions.find((s) => s.key === subagentState.selectedKey) ?? null;
}

export function getSortedSubagents(): SubagentSession[] {
	return [...subagentState.sessions].sort((a, b) => {
		const aRunning = isRunning(a);
		const bRunning = isRunning(b);
		if (aRunning !== bRunning) return aRunning ? -1 : 1;
		return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
	});
}

// ── Tree ──────────────────────────────────────────────────────

export interface SubagentTreeNode {
	session: SubagentSession;
	children: SubagentTreeNode[];
}

export function getSubagentTree(): SubagentTreeNode[] {
	const sessions = getSortedSubagents();
	const byKey = new Map(sessions.map((s) => [s.key, s]));
	const childrenMap = new Map<string, SubagentTreeNode[]>();
	const roots: SubagentTreeNode[] = [];

	for (const s of sessions) {
		const node: SubagentTreeNode = { session: s, children: [] };
		if (s.spawnedBy && byKey.has(s.spawnedBy)) {
			const siblings = childrenMap.get(s.spawnedBy) ?? [];
			siblings.push(node);
			childrenMap.set(s.spawnedBy, siblings);
		} else {
			roots.push(node);
		}
	}

	// Attach children to parent nodes
	function attachChildren(nodes: SubagentTreeNode[]) {
		for (const node of nodes) {
			node.children = childrenMap.get(node.session.key) ?? [];
			attachChildren(node.children);
		}
	}
	attachChildren(roots);

	return roots;
}

// ── Helpers ────────────────────────────────────────────────────

export function isRunning(s: SubagentSession): boolean {
	const recency = Date.now() - (s.updatedAt ?? 0);
	return !s.abortedLastRun && recency < 5 * 60_000;
}

export function resolveStatus(s: SubagentSession): SubagentStatus {
	if (s.abortedLastRun) return 'failed';
	if (isRunning(s)) return 'running';
	if (s.updatedAt) return 'completed';
	return 'unknown';
}

export function formatDuration(s: SubagentSession): string {
	if (!s.updatedAt) return '\u2014';
	const ms = Date.now() - s.updatedAt;
	if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
	if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
	return `${Math.round(ms / 3_600_000)}h`;
}

// ── Actions ────────────────────────────────────────────────────

export async function loadSubagents(agentId: string) {
	subagentState.agentId = agentId;
	subagentState.loading = true;
	subagentState.error = null;

	try {
		const res = (await sendRequest('sessions.list', {
			agentId,
			includeGlobal: true,
			includeUnknown: true
		})) as { sessions?: SubagentSession[] };

		const subagentSessions = (res.sessions ?? []).filter((s) => s.key.includes(':subagent:'));
		subagentState.sessions = subagentSessions;
	} catch (e) {
		subagentState.error = e instanceof Error ? e.message : 'Failed to load subagents';
	} finally {
		subagentState.loading = false;
	}
}

export function handleSessionEvent(event: { key?: string; [k: string]: unknown }) {
	if (!subagentState.agentId) return;
	const key = event.key as string | undefined;
	if (!key || !key.includes(':subagent:')) return;
	if (!key.startsWith(`agent:${subagentState.agentId}:`)) return;

	const idx = subagentState.sessions.findIndex((s) => s.key === key);
	if (idx >= 0) {
		Object.assign(subagentState.sessions[idx], event);
	} else {
		subagentState.sessions.push(event as unknown as SubagentSession);
	}
}

export function selectSubagent(key: string | null) {
	subagentState.selectedKey = key;
}

export function clearSubagents() {
	subagentState.agentId = null;
	subagentState.sessions = [];
	subagentState.selectedKey = null;
	subagentState.loading = false;
	subagentState.error = null;
}
