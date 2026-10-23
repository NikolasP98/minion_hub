import { describe, expect, it, vi } from 'vitest';
import { classifyAssistantTurnWithEvidence } from './assistant-router.service';
const submissionId = '11111111-1111-4111-8111-111111111111';
const answer = {
  model: 'typesafe/jev-resolved',
  answers: { mode: { choice: 'chat', probabilities: { chat: 1 } }, sandbox: { noul: 0.5 } },
};
describe('actual classifier attempt provenance', () => {
  it('retains provider identity, canonical revisions, valid zero and both token naming conventions', async () => {
    for (const usage of [
      { cost: 0, input_tokens: 0, output_tokens: 4 },
      { cost: 0, prompt_tokens: 0, completion_tokens: 4 },
    ]) {
      const fetcher = vi.fn(async () => Response.json({ ...answer, usage }));
      const result = await classifyAssistantTurnWithEvidence(
        { text: 'private fixture text', submissionId },
        { apiKey: 'fixture', fetcher },
      );
      expect(result.decision?.manifests.sandbox).toBe(0.5);
      expect(result.attempt).toMatchObject({
        submissionId,
        requestedModel: '~typesafe/jev-latest',
        resolvedModel: answer.model,
        disposition: 'ok',
        cost: { status: 'known', usd: 0 },
        inputTokens: 0,
        outputTokens: 4,
      });
      for (const field of ['schemaRevision', 'questionRevision', 'gateRevision'] as const)
        expect(result.attempt?.[field]).toMatch(/^[a-f0-9]{64}$/);
      const other = await classifyAssistantTurnWithEvidence(
        { text: 'different fixture text' },
        { apiKey: 'fixture', fetcher },
      );
      expect(other.attempt?.questionRevision).toBe(result.attempt?.questionRevision);
    }
  });
  it.each([undefined, -1, NaN, Infinity])(
    'never converts absent or invalid cost %s to known zero',
    async (cost) => {
      const result = await classifyAssistantTurnWithEvidence(
        { text: 'hi' },
        { apiKey: 'fixture', fetcher: async () => Response.json({ ...answer, usage: { cost } }) },
      );
      expect(result.attempt?.cost).toEqual({ status: 'unknown', usd: null });
    },
  );
  it('measures failed and malformed attempts and preserves HTTP-error usage before decision parsing', async () => {
    const clock = vi.spyOn(Date, 'now');
    let now = 1000;
    clock.mockImplementation(() => now);
    try {
      const failed = await classifyAssistantTurnWithEvidence(
        { text: 'hi' },
        {
          apiKey: 'fixture',
          fetcher: async () => {
            now += 37;
            return Response.json({ ...answer, usage: { cost: 0 } }, { status: 503 });
          },
        },
      );
      expect(failed).toMatchObject({
        decision: null,
        attempt: { elapsedMs: 37, disposition: 'error', cost: { status: 'known', usd: 0 } },
      });
      const malformed = await classifyAssistantTurnWithEvidence(
        { text: 'hi' },
        {
          apiKey: 'fixture',
          fetcher: async () => {
            now += 17;
            return new Response('not-json');
          },
        },
      );
      expect(malformed).toMatchObject({
        decision: null,
        attempt: { elapsedMs: 17, disposition: 'invalid', cost: { status: 'unknown', usd: null } },
      });
      const timeout = await classifyAssistantTurnWithEvidence(
        { text: 'hi' },
        {
          apiKey: 'fixture',
          fetcher: async () => {
            now += 1500;
            throw new DOMException('fixture timeout', 'TimeoutError');
          },
        },
      );
      expect(timeout.attempt).toMatchObject({
        elapsedMs: 1500,
        disposition: 'timeout',
        resolvedModel: null,
      });
    } finally {
      clock.mockRestore();
    }
  });
  it('does not invent an attempt for a missing key or empty input', async () => {
    const fetcher = vi.fn();
    for (const input of [{ text: '' }, { text: 'hi' }])
      expect(await classifyAssistantTurnWithEvidence(input, { apiKey: '', fetcher })).toEqual({
        decision: null,
        attempt: null,
      });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
