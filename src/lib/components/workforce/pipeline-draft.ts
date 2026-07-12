// Pure helpers for the pipeline builder (workforce/projects/[id]/pipelines).
// Kept out of the .svelte file so they're unit-testable.
import type { Pipeline, PipelineStep, PipelineStepKind, PipelineTrigger } from '@minion-stack/workforce-client';

export interface DraftStep {
	key: string;
	kind: PipelineStepKind;
	label: string;
	participantType: 'agent' | 'user';
	agentId: string;
	userId: string;
	rubric: string;
	minScore: number | null;
	maxScore: number | null;
}

export interface Draft {
	name: string;
	description: string;
	originKinds: string[];
	labels: string; // comma-separated free text
	priorities: string[];
	steps: DraftStep[];
}

let keyCounter = 0;
export function newStep(kind: PipelineStepKind = 'review'): DraftStep {
	return {
		key: `step-${Date.now()}-${keyCounter++}`,
		kind,
		label: '',
		participantType: 'agent',
		agentId: '',
		userId: '',
		rubric: '',
		minScore: null,
		maxScore: null,
	};
}

export function emptyDraft(): Draft {
	return {
		name: '',
		description: '',
		originKinds: [],
		labels: '',
		priorities: [],
		steps: [{ ...newStep('work'), label: 'Work' }],
	};
}

export function draftFromPipeline(p: Pipeline): Draft {
	return {
		name: p.name,
		description: p.description ?? '',
		originKinds: p.trigger?.originKinds ?? [],
		labels: (p.trigger?.labels ?? []).join(', '),
		priorities: p.trigger?.priorities ?? [],
		steps: p.steps.map((s) => ({
			key: s.key,
			kind: s.kind,
			label: s.label,
			participantType: s.participant.type,
			agentId: s.participant.agentId ?? '',
			userId: s.participant.userId ?? '',
			rubric: s.rubric ?? '',
			minScore: s.minScore ?? null,
			maxScore: s.maxScore ?? null,
		})),
	};
}

/**
 * Swap step at `index` with its neighbor in `dir`. Returns a NEW array; the
 * original is untouched. Out-of-range moves (including anything that would
 * displace the locked work step at 0) return the input array unchanged.
 */
export function moveStep<T>(steps: T[], index: number, dir: -1 | 1): T[] {
	const target = index + dir;
	// index 0 is the locked work step: it can't move and nothing can take its place.
	if (index <= 0 || target <= 0 || target >= steps.length) return steps;
	const next = [...steps];
	[next[index], next[target]] = [next[target], next[index]];
	return next;
}

/** Mirror of the server-enforced step rules. Empty array = valid. */
export function draftErrors(d: Draft): string[] {
	const errs: string[] = [];
	if (!d.name.trim()) errs.push('name');
	if (d.steps.length === 0) errs.push('steps');
	d.steps.forEach((s, i) => {
		if (i === 0 && (s.kind !== 'work' || s.participantType !== 'agent' || !s.agentId)) errs.push('step0');
		if (i > 0 && s.kind === 'work') errs.push(`step${i}:work`);
		if (!s.label.trim()) errs.push(`step${i}:label`);
		if (s.participantType === 'agent' && !s.agentId) errs.push(`step${i}:agent`);
		if (s.participantType === 'user' && !s.userId.trim()) errs.push(`step${i}:user`);
		if (s.kind === 'eval') {
			const min = s.minScore;
			const max = s.maxScore;
			if (!s.rubric.trim() || min === null || max === null || max < min) errs.push(`step${i}:eval`);
		}
	});
	return errs;
}

/** Serialize a valid draft into the pipelines POST/PATCH body. */
export function draftToPayload(d: Draft, projectId: string): Record<string, unknown> {
	const labels = d.labels
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	const trigger: PipelineTrigger = {};
	if (d.originKinds.length) trigger.originKinds = d.originKinds;
	if (labels.length) trigger.labels = labels;
	if (d.priorities.length) trigger.priorities = d.priorities;
	const steps: PipelineStep[] = d.steps.map((s) => ({
		key: s.key,
		kind: s.kind,
		label: s.label.trim(),
		participant:
			s.participantType === 'agent' ? { type: 'agent', agentId: s.agentId } : { type: 'user', userId: s.userId.trim() },
		...(s.kind === 'eval' ? { rubric: s.rubric, minScore: s.minScore, maxScore: s.maxScore } : {}),
	}));
	return {
		projectId,
		name: d.name.trim(),
		description: d.description.trim() || null,
		trigger: Object.keys(trigger).length ? trigger : null,
		steps,
	};
}
