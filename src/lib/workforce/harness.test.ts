import { describe, expect, it } from 'vitest';
import { harnessAgentIds, normalizeHarness, normalizeHarnessBatch } from './harness';

describe('living harness normalization', () => {
	it('keeps active configuration distinct from recommendations', () => {
		const harness = normalizeHarness({ agentId: 'a1', revisionNumber: 3, contentHash: 'abcdef', active: { primaryModel: 'claude-sonnet', fallbackModels: ['gpt-5'] }, recommended: { primaryModel: 'claude-opus' }, skills: [{ key: 'review' }], tools: ['bash'], performance: { successRate: 0.8 } });
		expect(harness?.activePrimary?.model).toBe('claude-sonnet');
		expect(harness?.recommendedPrimary?.model).toBe('claude-opus');
		expect(harness?.skills).toEqual(['review']);
	});

	it('accepts wrapped batch responses', () => {
		expect(normalizeHarnessBatch({ harnesses: [{ agentId: 'a1', revision: 1 }] }).a1?.revision).toBe(1);
	});

	it('normalizes the Paperclip runtime policy contract', () => {
		const harness = normalizeHarness({ agentId: 'a1', revisionNumber: 2, roleKey: 'bug-fixer', runtime: { runtimeClass: 'coding', active: { primary: { model: 'gpt-5.3-codex', provider: 'openai' }, fallbacks: [] }, recommended: { primary: { model: 'claude-sonnet', provider: 'anthropic' }, fallbacks: [] }, tools: ['shell'], skills: ['debugging'] }, learning: { proposalScoreThreshold: 7, minimumSignals: 2 } });
		expect(harness).toMatchObject({ roleClass: 'bug-fixer', runtimeClass: 'coding', activePrimary: { model: 'gpt-5.3-codex' }, recommendedPrimary: { model: 'claude-sonnet' }, tools: ['shell'], skills: ['debugging'] });
		expect(harness?.learningPolicy).toContain('2 signal');
	});

	it('deduplicates pipeline participants and issue assignees', () => {
		expect(harnessAgentIds([{ steps: [{ participant: { type: 'agent', agentId: 'a1' } }, { participant: { type: 'user' } }] }], [{ assigneeAgentId: 'a1' }, { assigneeAgentId: 'a2' }])).toEqual(['a1', 'a2']);
	});
});
