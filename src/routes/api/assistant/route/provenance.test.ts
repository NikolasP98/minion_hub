import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
const sink = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock('$env/dynamic/private', () => ({ env: { OPENROUTER_API_KEY: 'fixture-only' } }));
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_POSTHOG_KEY: 'fixture-key' } }));
vi.mock('posthog-node', () => ({
  PostHog: class {
    capture = sink.capture;
    on() {}
    flush = async () => {};
  },
}));
import { POST } from './+server';
const id = '11111111-1111-4111-8111-111111111111';
afterEach(() => {
  vi.unstubAllGlobals();
  sink.capture.mockClear();
});
describe('actual route → classifier → SDK provenance', () => {
  it.each([id, 'forged non-uuid'])(
    'validates early correlation %s without deriving authority from it',
    async (submissionId) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          Response.json({
            model: 'typesafe/jev-resolved',
            answers: {
              mode: { choice: 'chat', probabilities: { chat: 1 } },
              sandbox: { noul: 0.75 },
            },
            usage: { input_tokens: 7, output_tokens: 3, cost: 0 },
          }),
        ),
      );
      const request = new Request('http://localhost/api/assistant/route', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-minion-run-id': submissionId },
        body: JSON.stringify({ text: 'private fixture text', locale: 'en' }),
      });
      const response = await POST({
        request,
        route: { id: '/api/assistant/route' },
        locals: { user: { id: 'server-actor' }, tenantCtx: { tenantId: 'server-org' } },
      } as unknown as RequestEvent);
      const body = await response.json();
      expect(body.attempt.submissionId).toBe(submissionId === id ? id : null);
      await vi.dynamicImportSettled();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(sink.capture).toHaveBeenCalledTimes(1);
      const properties = sink.capture.mock.calls[0][0].properties;
      expect(properties).toMatchObject({
        actor_id: 'server-actor',
        org_id: 'server-org',
        requested_model: '~typesafe/jev-latest',
        resolved_model: 'typesafe/jev-resolved',
        p_sandbox: 0.75,
        assistant_cost_usd: 0,
        cost_status: 'known',
        input_tokens: 7,
        output_tokens: 3,
      });
      expect(properties.submission_id).toBe(submissionId === id ? id : undefined);
      expect(JSON.stringify(properties)).not.toContain('private fixture text');
    },
  );
});
