import { describe, it, expect, vi, beforeEach } from 'vitest';

const generateText = vi.fn<() => Promise<{ text: string }>>();
vi.mock('ai', () => ({ generateText: () => generateText() }));
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: () => () => ({}) }));

const envObj: Record<string, string> = { OPENROUTER_API_KEY: 'test-key' };
vi.mock('$env/dynamic/private', () => ({ env: new Proxy(envObj, { get: (t, p) => t[p as string] }) }));

function makeLocals(auth = true): App.Locals {
  return {
    user: auth ? { id: 'u1', email: 't@t.com', displayName: 'T', role: 'user' } : undefined,
  } as App.Locals;
}

function call(body: unknown, auth = true) {
  return import('./+server').then(({ POST }) =>
    POST({
      locals: makeLocals(auth),
      request: new Request('http://x/api/notes/polish', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    } as Parameters<typeof POST>[0]),
  );
}

beforeEach(() => vi.clearAllMocks());

describe('POST /api/notes/polish', () => {
  it('returns the cleaned-up text, trimmed', async () => {
    generateText.mockResolvedValue({ text: '  Hello, my name is Nicholas.  \n' });
    const res = await call({ text: 'hello my name is nicholas' });
    const body = await res.json();
    expect(body.text).toBe('Hello, my name is Nicholas.');
  });

  it('short-circuits empty input without calling the model', async () => {
    const res = await call({ text: '   ' });
    expect((await res.json()).text).toBe('');
    expect(generateText).not.toHaveBeenCalled();
  });

  it('401s when unauthenticated', async () => {
    let status = 0;
    try {
      await call({ text: 'x' }, false);
    } catch (e) {
      status = (e as { status?: number }).status ?? 0;
    }
    expect(status).toBe(401);
    expect(generateText).not.toHaveBeenCalled();
  });

  it('503s when no API key is configured', async () => {
    delete envObj.OPENROUTER_API_KEY;
    let status = 0;
    try {
      await call({ text: 'x' });
    } catch (e) {
      status = (e as { status?: number }).status ?? 0;
    }
    expect(status).toBe(503);
    envObj.OPENROUTER_API_KEY = 'test-key';
  });
});
