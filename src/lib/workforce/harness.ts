export type HarnessModel = { model: string; provider: string | null };

export type HarnessSummary = {
	agentId: string;
	revision: number | null;
	hash: string | null;
	roleClass: string | null;
	runtimeClass: string | null;
	activePrimary: HarnessModel | null;
	activeFallbacks: HarnessModel[];
	recommendedPrimary: HarnessModel | null;
	recommendedFallbacks: HarnessModel[];
	tools: string[];
	skills: string[];
	learningPolicy: string | null;
	performance: { successRate: number | null; avgScore: number | null; runCount: number | null; costCents: number | null };
};

export type HarnessSignal = { id: string; kind: string; summary: string; createdAt: string | null };
export type HarnessProposal = { id: string; status: string; summary: string; createdAt: string | null };

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
function text(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function number(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function model(value: unknown): HarnessModel | null {
	if (typeof value === 'string') return value.trim() ? { model: value, provider: null } : null;
	const row = record(value);
	const modelName = text(row?.model ?? row?.modelId ?? row?.name);
	return modelName ? { model: modelName, provider: text(row?.provider) } : null;
}
function models(value: unknown): HarnessModel[] {
	return Array.isArray(value) ? value.map(model).filter((item): item is HarnessModel => item !== null) : [];
}
function names(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.map((item) => typeof item === 'string' ? text(item) : text(record(item)?.name ?? record(item)?.key)).filter((item): item is string => item !== null);
}

export function normalizeHarness(value: unknown, fallbackAgentId = ''): HarnessSummary | null {
	const root = record(value);
	if (!root) return null;
	const runtime = record(root.runtime) ?? {};
	const active = record(runtime.active ?? root.active ?? root.activeConfiguration ?? root.configuration) ?? {};
	const recommended = record(runtime.recommended ?? root.recommended ?? root.recommendation) ?? {};
	const performance = record(root.performance ?? root.metrics) ?? {};
	const learning = record(root.learningPolicy);
	const learningConfig = learning ?? record(root.learning);
	const threshold = number(learningConfig?.proposalScoreThreshold);
	const minimumSignals = number(learningConfig?.minimumSignals);
	return {
		agentId: text(root.agentId) ?? fallbackAgentId,
		revision: number(root.revision ?? root.revisionNumber),
		hash: text(root.hash ?? root.contentHash),
		roleClass: text(root.roleClass ?? root.harnessRole ?? root.roleKey),
		runtimeClass: text(runtime.runtimeClass ?? root.runtimeClass ?? root.executionClass),
		activePrimary: model(active.primary ?? active.primaryModel ?? root.activePrimaryModel),
		activeFallbacks: models(active.fallbacks ?? active.fallbackModels ?? root.activeFallbackModels),
		recommendedPrimary: model(recommended.primary ?? recommended.primaryModel ?? root.recommendedPrimaryModel),
		recommendedFallbacks: models(recommended.fallbacks ?? recommended.fallbackModels ?? root.recommendedFallbackModels),
		tools: names(runtime.tools ?? root.tools ?? active.tools),
		skills: names(runtime.skills ?? root.skills ?? active.skills),
		learningPolicy: text(root.learningPolicy) ?? text(learningConfig?.mode ?? learningConfig?.policy) ?? (threshold == null ? null : `score < ${threshold}${minimumSignals == null ? '' : ` · ${minimumSignals} signal minimum`}`),
		performance: {
			successRate: number(performance.successRate),
			avgScore: number(performance.avgScore ?? performance.averageScore),
			runCount: number(performance.runCount ?? performance.runs),
			costCents: number(performance.costCents),
		},
	};
}

export function normalizeHarnessBatch(value: unknown): Record<string, HarnessSummary> {
	const root = record(value);
	const rows = Array.isArray(value) ? value : Array.isArray(root?.agents) ? root.agents : Array.isArray(root?.harnesses) ? root.harnesses : [];
	const result: Record<string, HarnessSummary> = {};
	for (const row of rows) {
		const harness = normalizeHarness(row);
		if (harness?.agentId) result[harness.agentId] = harness;
	}
	return result;
}

function normalizeFeed(value: unknown, proposal: boolean): Array<HarnessSignal | HarnessProposal> {
	const root = record(value);
	const rows = Array.isArray(value) ? value : Array.isArray(root?.items) ? root.items : proposal && Array.isArray(root?.proposals) ? root.proposals : !proposal && Array.isArray(root?.signals) ? root.signals : [];
	return rows.flatMap((value, index) => {
		const row = record(value);
		if (!row) return [];
		const summary = text(row.summary ?? row.title ?? row.message ?? row.body ?? row.rationale);
		if (!summary) return [];
		return [{ id: text(row.id) ?? `${proposal ? 'proposal' : 'signal'}-${index}`, ...(proposal ? { status: text(row.status) ?? 'pending' } : { kind: text(row.kind ?? row.type ?? row.signalType) ?? 'signal' }), summary, createdAt: text(row.createdAt) }];
	});
}

export const normalizeHarnessSignals = (value: unknown): HarnessSignal[] => normalizeFeed(value, false) as HarnessSignal[];
export const normalizeHarnessProposals = (value: unknown): HarnessProposal[] => normalizeFeed(value, true) as HarnessProposal[];

export function harnessAgentIds(pipelines: Array<{ steps?: Array<{ participant?: { type?: string; agentId?: string | null } }> }>, issues: Array<{ assigneeAgentId?: string | null }>): string[] {
	return [...new Set([
		...pipelines.flatMap((pipeline) => pipeline.steps ?? []).map((step) => step.participant?.type === 'agent' ? step.participant.agentId : null),
		...issues.map((issue) => issue.assigneeAgentId),
	].filter((id): id is string => typeof id === 'string' && id.length > 0))];
}
