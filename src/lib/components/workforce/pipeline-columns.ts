// Pure column derivation for the pipeline-step execution kanban (spec §2.1).
// Pipeline steps: steps[0] = work; steps[1..n] compile to executionPolicy stages[0..n-1],
// so an in_review issue at stage index k sits on pipeline step k+1.
import type { IssueStatus, PipelineStep } from '@minion-stack/workforce-client';

/** The scalars the paperclip issue LIST rows carry beyond the client Issue type. */
export interface KanbanIssueLike {
	status: IssueStatus;
	assigneeAgentId: string | null;
	assigneeUserId: string | null;
	currentStageIndex?: number | null;
}

export type PipelineColumnKind = 'intake' | 'step' | 'review' | 'done' | 'blocked';

export interface PipelineColumnBucket<T> {
	key: string;
	kind: PipelineColumnKind;
	stepIndex: number | null;
	issues: T[];
}

/** Column key for one issue. Exported for the bucketing-matrix test. */
export function issueColumnKey(iss: KanbanIssueLike, steps: PipelineStep[]): string {
	switch (iss.status) {
		case 'backlog':
		case 'todo':
			return 'intake';
		case 'in_progress':
			return 'step:0'; // covers changes_requested bounces too
		case 'done':
		case 'cancelled':
			return 'done';
		case 'blocked':
			return 'blocked';
		case 'in_review': {
			const idx = iss.currentStageIndex;
			if (idx != null && idx + 1 >= 1 && idx + 1 < steps.length) return `step:${idx + 1}`;
			// Fallback (index null or out of range — e.g. policy predates the pipeline):
			if (iss.assigneeUserId) {
				for (let i = steps.length - 1; i >= 1; i--) {
					if (steps[i].participant.type === 'user') return `step:${i}`;
				}
			}
			if (iss.assigneeAgentId) {
				const i = steps.findIndex(
					(s, j) => j >= 1 && s.participant.type === 'agent' && s.participant.agentId === iss.assigneeAgentId,
				);
				if (i >= 1) return `step:${i}`;
			}
			return 'review'; // generic bucket, rendered only when non-empty
		}
	}
}

/**
 * Bucket issues into ordered kanban columns:
 * Intake, one per pipeline step, [In review], Done, [Blocked].
 * The bracketed columns appear only when non-empty.
 */
export function pipelineColumns<T extends KanbanIssueLike>(
	steps: PipelineStep[],
	issues: T[],
): PipelineColumnBucket<T>[] {
	const buckets = new Map<string, T[]>();
	for (const iss of issues) {
		const key = issueColumnKey(iss, steps);
		const list = buckets.get(key);
		if (list) list.push(iss);
		else buckets.set(key, [iss]);
	}
	const cols: PipelineColumnBucket<T>[] = [
		{ key: 'intake', kind: 'intake', stepIndex: null, issues: buckets.get('intake') ?? [] },
		...steps.map((_, i) => ({
			key: `step:${i}`,
			kind: 'step' as const,
			stepIndex: i,
			issues: buckets.get(`step:${i}`) ?? [],
		})),
	];
	const review = buckets.get('review') ?? [];
	if (review.length) cols.push({ key: 'review', kind: 'review', stepIndex: null, issues: review });
	cols.push({ key: 'done', kind: 'done', stepIndex: null, issues: buckets.get('done') ?? [] });
	const blocked = buckets.get('blocked') ?? [];
	if (blocked.length) cols.push({ key: 'blocked', kind: 'blocked', stepIndex: null, issues: blocked });
	return cols;
}
