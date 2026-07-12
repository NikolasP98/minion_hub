import { describe, it, expect } from 'vitest';
import type { PipelineStep, IssueStatus } from '@minion-stack/workforce-client';
import { issueColumnKey, pipelineColumns, type KanbanIssueLike } from './pipeline-columns';

// Fix(agent-1) → Eval(agent-2) → Review(agent-3) → Approval(user-1)
const steps: PipelineStep[] = [
	{ key: 'fix', kind: 'work', label: 'Fix', participant: { type: 'agent', agentId: 'agent-1' } },
	{ key: 'eval', kind: 'eval', label: 'Eval', participant: { type: 'agent', agentId: 'agent-2' } },
	{ key: 'review', kind: 'review', label: 'Review', participant: { type: 'agent', agentId: 'agent-3' } },
	{ key: 'approve', kind: 'approval', label: 'Approval', participant: { type: 'user', userId: 'user-1' } },
];

function iss(status: IssueStatus, extra: Partial<KanbanIssueLike> = {}): KanbanIssueLike {
	return { status, assigneeAgentId: null, assigneeUserId: null, currentStageIndex: null, ...extra };
}

describe('issueColumnKey — bucketing matrix (spec §2.1)', () => {
	it('backlog/todo → intake', () => {
		expect(issueColumnKey(iss('backlog'), steps)).toBe('intake');
		expect(issueColumnKey(iss('todo'), steps)).toBe('intake');
	});
	it('in_progress → step 0 (including changes_requested bounces)', () => {
		expect(issueColumnKey(iss('in_progress', { assigneeAgentId: 'agent-1' }), steps)).toBe('step:0');
	});
	it('in_review with currentStageIndex k → step k+1', () => {
		expect(issueColumnKey(iss('in_review', { currentStageIndex: 0 }), steps)).toBe('step:1');
		expect(issueColumnKey(iss('in_review', { currentStageIndex: 2 }), steps)).toBe('step:3');
	});
	it('in_review index null + assigneeUserId → last user-participant step', () => {
		expect(issueColumnKey(iss('in_review', { assigneeUserId: 'user-1' }), steps)).toBe('step:3');
	});
	it('in_review index null + assigneeAgentId matching a gate participant → that step', () => {
		expect(issueColumnKey(iss('in_review', { assigneeAgentId: 'agent-3' }), steps)).toBe('step:2');
	});
	it('in_review with no resolvable step → generic review bucket', () => {
		expect(issueColumnKey(iss('in_review'), steps)).toBe('review');
		expect(issueColumnKey(iss('in_review', { assigneeAgentId: 'agent-unknown' }), steps)).toBe('review');
	});
	it('in_review out-of-range index falls back like null', () => {
		expect(issueColumnKey(iss('in_review', { currentStageIndex: 99 }), steps)).toBe('review');
	});
	it('done/cancelled → done', () => {
		expect(issueColumnKey(iss('done'), steps)).toBe('done');
		expect(issueColumnKey(iss('cancelled'), steps)).toBe('done');
	});
	it('blocked → blocked', () => {
		expect(issueColumnKey(iss('blocked'), steps)).toBe('blocked');
	});
});

describe('pipelineColumns', () => {
	it('always renders intake + one column per step + done; review/blocked only when non-empty', () => {
		const cols = pipelineColumns(steps, [iss('todo'), iss('done')]);
		expect(cols.map((c) => c.key)).toEqual(['intake', 'step:0', 'step:1', 'step:2', 'step:3', 'done']);
	});
	it('appends review and blocked columns when occupied', () => {
		const cols = pipelineColumns(steps, [iss('in_review'), iss('blocked')]);
		expect(cols.map((c) => c.key)).toEqual([
			'intake', 'step:0', 'step:1', 'step:2', 'step:3', 'review', 'done', 'blocked',
		]);
		expect(cols.find((c) => c.kind === 'review')?.issues).toHaveLength(1);
		expect(cols.find((c) => c.kind === 'blocked')?.issues).toHaveLength(1);
	});
	it('buckets issues into the right columns', () => {
		const inFix = iss('in_progress');
		const inEval = iss('in_review', { currentStageIndex: 0 });
		const cols = pipelineColumns(steps, [inFix, inEval]);
		expect(cols.find((c) => c.key === 'step:0')?.issues).toEqual([inFix]);
		expect(cols.find((c) => c.key === 'step:1')?.issues).toEqual([inEval]);
	});
});
