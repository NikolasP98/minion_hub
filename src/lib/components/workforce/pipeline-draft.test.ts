import { describe, it, expect } from 'vitest';
import { moveStep, draftErrors, draftToPayload, emptyDraft, newStep, type Draft } from './pipeline-draft';

describe('moveStep', () => {
	const arr = ['work', 'eval', 'review', 'approval'];
	it('swaps adjacent steps', () => {
		expect(moveStep(arr, 1, 1)).toEqual(['work', 'review', 'eval', 'approval']);
		expect(moveStep(arr, 2, -1)).toEqual(['work', 'review', 'eval', 'approval']);
	});
	it('never displaces the locked work step at index 0', () => {
		expect(moveStep(arr, 0, 1)).toBe(arr);
		expect(moveStep(arr, 1, -1)).toBe(arr);
	});
	it('no-ops at the tail boundary', () => {
		expect(moveStep(arr, 3, 1)).toBe(arr);
	});
	it('does not mutate the input', () => {
		moveStep(arr, 1, 1);
		expect(arr).toEqual(['work', 'eval', 'review', 'approval']);
	});
});

function validDraft(): Draft {
	const d = emptyDraft();
	d.name = 'Bugs';
	d.steps[0].agentId = 'agent-1';
	d.steps[0].label = 'Fix';
	return d;
}

describe('draftErrors', () => {
	it('accepts a minimal valid draft', () => {
		expect(draftErrors(validDraft())).toEqual([]);
	});
	it('requires name and a work+agent step 0', () => {
		const d = validDraft();
		d.name = '';
		d.steps[0].agentId = '';
		expect(draftErrors(d)).toContain('name');
		expect(draftErrors(d)).toContain('step0');
	});
	it('forbids a second work step', () => {
		const d = validDraft();
		d.steps.push({ ...newStep('work'), label: 'More work', agentId: 'a' });
		expect(draftErrors(d)).toContain('step1:work');
	});
	it('requires rubric + minScore + maxScore>=minScore on eval steps', () => {
		const d = validDraft();
		const ev = { ...newStep('eval'), label: 'Eval', agentId: 'a' };
		d.steps.push(ev);
		expect(draftErrors(d)).toContain('step1:eval');
		ev.rubric = 'quality';
		ev.minScore = 7;
		ev.maxScore = 5; // max < min
		expect(draftErrors(d)).toContain('step1:eval');
		ev.maxScore = 10;
		expect(draftErrors(d)).toEqual([]);
	});
	it('requires a userId for user participants', () => {
		const d = validDraft();
		d.steps.push({ ...newStep('approval'), label: 'HITL', participantType: 'user' });
		expect(draftErrors(d)).toContain('step1:user');
	});
});

describe('draftToPayload', () => {
	it('serializes trigger and eval fields, null-ing empties', () => {
		const d = validDraft();
		d.originKinds = ['github_issue'];
		d.labels = ' bug , urgent ,';
		const ev = { ...newStep('eval'), label: 'Eval', agentId: 'a2', rubric: 'r', minScore: 7, maxScore: 10 };
		d.steps.push(ev);
		const p = draftToPayload(d, 'proj-1');
		expect(p.projectId).toBe('proj-1');
		expect(p.trigger).toEqual({ originKinds: ['github_issue'], labels: ['bug', 'urgent'] });
		expect(p.description).toBeNull();
		const steps = p.steps as Array<Record<string, unknown>>;
		expect(steps[0].participant).toEqual({ type: 'agent', agentId: 'agent-1' });
		expect(steps[0]).not.toHaveProperty('rubric');
		expect(steps[1]).toMatchObject({ kind: 'eval', rubric: 'r', minScore: 7, maxScore: 10 });
	});
	it('omits trigger entirely when empty', () => {
		expect(draftToPayload(validDraft(), 'p').trigger).toBeNull();
	});
});
