import { describe, test, expect, vi } from 'vitest';
import { classifyAssistantTurn } from './assistant-router.service';

/** The classifier is NEVER called for real here — every test fakes the fetch. */
function fakeFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return vi.fn(
    async () =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status: init.status ?? (init.ok === false ? 500 : 200),
      }),
  ) as unknown as typeof fetch;
}

const okAnswer = {
  model: 'typesafe/jev-1.13-20260917',
  answers: {
    mode: {
      type: 'choice',
      choice: 'data_question',
      probabilities: {
        navigate: 0.01,
        record_action: 0,
        data_question: 0.97,
        knowledge_question: 0.02,
        chat: 0,
      },
    },
    pages: { type: 'noul', noul: 0.23 },
    forms: { type: 'noul', noul: 0.14 },
    data: { type: 'noul', noul: 0.92 },
    brain: { type: 'noul', noul: 0.5 },
    changelog: { type: 'noul', noul: 0.01 },
  },
  usage: { input_tokens: 525, output_tokens: 146, cost: 0.00002205 },
};

describe('classifyAssistantTurn', () => {
  test('returns the mode, its distribution and a probability per manifest', async () => {
    const decision = await classifyAssistantTurn(
      { text: '¿cuántas facturas pagó Ana este mes?', locale: 'es' },
      { apiKey: 'k', fetcher: fakeFetch(okAnswer) },
    );
    expect(decision?.mode).toBe('data_question');
    expect(decision?.probabilities.data_question).toBe(0.97);
    expect(decision?.manifests).toEqual({
      pages: 0.23,
      forms: 0.14,
      data: 0.92,
      brain: 0.5,
      changelog: 0.01,
    });
    expect(decision?.cost).toBe(0.00002205);
    expect(decision?.ms).toBeGreaterThanOrEqual(0);
  });

  test('asks one choice over the five modes plus one noul per manifest', async () => {
    const fetcher = fakeFetch(okAnswer);
    await classifyAssistantTurn({ text: 'hola' }, { apiKey: 'k', fetcher });
    const [, init] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('~typesafe/jev-latest');
    expect(body.questions.mode.type).toBe('choice');
    expect(Object.keys(body.questions.mode.criteria).sort()).toEqual([
      'chat',
      'data_question',
      'knowledge_question',
      'navigate',
      'record_action',
    ]);
    for (const id of ['pages', 'forms', 'data', 'brain', 'changelog']) {
      expect(body.questions[id].type).toBe('noul');
    }
  });

  test('the request carries the user text as fenced state, capped', async () => {
    const fetcher = fakeFetch(okAnswer);
    await classifyAssistantTurn({ text: 'x'.repeat(5000) }, { apiKey: 'k', fetcher });
    const [, init] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.state).toContain('REQUEST:');
    expect(body.state.length).toBeLessThan(2200);
  });

  // Every one of these is a fail-open path: null means "send the full envelope".
  test('a missing API key never calls out and yields null', async () => {
    const fetcher = fakeFetch(okAnswer);
    expect(await classifyAssistantTurn({ text: 'hi' }, { apiKey: '', fetcher })).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('empty text yields null without a call', async () => {
    const fetcher = fakeFetch(okAnswer);
    expect(await classifyAssistantTurn({ text: '   ' }, { apiKey: 'k', fetcher })).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('a non-200 yields null', async () => {
    expect(
      await classifyAssistantTurn(
        { text: 'hi' },
        { apiKey: 'k', fetcher: fakeFetch({}, { status: 503 }) },
      ),
    ).toBeNull();
  });

  test('a thrown fetch (timeout/abort/network) yields null', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('aborted');
    }) as unknown as typeof fetch;
    expect(await classifyAssistantTurn({ text: 'hi' }, { apiKey: 'k', fetcher })).toBeNull();
  });

  test('malformed JSON yields null', async () => {
    expect(
      await classifyAssistantTurn({ text: 'hi' }, { apiKey: 'k', fetcher: fakeFetch('not json') }),
    ).toBeNull();
  });

  test('a response with no answers yields null', async () => {
    expect(
      await classifyAssistantTurn(
        { text: 'hi' },
        { apiKey: 'k', fetcher: fakeFetch({ usage: {} }) },
      ),
    ).toBeNull();
  });

  test('a mode-only response with no manifest answers yields null', async () => {
    const decision = await classifyAssistantTurn(
      { text: 'hi' },
      { apiKey: 'k', fetcher: fakeFetch({ answers: { mode: okAnswer.answers.mode } }) },
    );
    expect(decision).toBeNull();
  });

  test('an unknown declared choice falls back to the argmax of the validated distribution', async () => {
    const decision = await classifyAssistantTurn(
      { text: 'hi' },
      {
        apiKey: 'k',
        fetcher: fakeFetch({
          answers: {
            mode: {
              choice: 'something_else',
              probabilities: { navigate: 0.7, chat: 0.3 },
            },
            pages: { noul: 0.8 },
          },
        }),
      },
    );
    expect(decision?.mode).toBe('navigate');
  });

  test('out-of-range probabilities are dropped, not clamped', async () => {
    const decision = await classifyAssistantTurn(
      { text: 'hi' },
      {
        apiKey: 'k',
        fetcher: fakeFetch({
          answers: {
            mode: { choice: 'chat', probabilities: { chat: 1, navigate: 7 } },
            pages: { noul: 1.4 },
            data: { noul: 0.6 },
          },
        }),
      },
    );
    expect(decision?.probabilities.navigate).toBeUndefined();
    expect(decision?.manifests.pages).toBeUndefined();
    expect(decision?.manifests.data).toBe(0.6);
  });
});
