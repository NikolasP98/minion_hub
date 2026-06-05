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
      request: new Request('http://x/api/notes/autocomplete', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    } as Parameters<typeof POST>[0]),
  );
}

beforeEach(() => vi.clearAllMocks());

describe('POST /api/notes/autocomplete', () => {
  it('returns a paragraph continuation for a note', async () => {
    generateText.mockResolvedValue({ text: 'and then the sun set.' });
    const res = await call({ kind: 'note', context: 'The day was long' });
    const body = await res.json();
    expect(body.suggestion).toBe(' and then the sun set.'); // space added before word
  });

  it('returns parsed items for a todo, stripping bullets/numbers', async () => {
    generateText.mockResolvedValue({ text: '- buy milk\n* eggs\n2. bread\n\n' });
    const res = await call({ kind: 'todo', context: 'groceries' });
    const body = await res.json();
    expect(body.items).toEqual(['buy milk', 'eggs', 'bread']);
  });

  it('caps todo suggestions at 5', async () => {
    generateText.mockResolvedValue({ text: 'a\nb\nc\nd\ne\nf\ng' });
    const res = await call({ kind: 'todo', context: 'x' });
    expect((await res.json()).items).toHaveLength(5);
  });

  it('401s when unauthenticated', async () => {
    let status = 0;
    try {
      await call({ kind: 'note', context: 'x' }, false);
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
      await call({ kind: 'note', context: 'x' });
    } catch (e) {
      status = (e as { status?: number }).status ?? 0;
    }
    expect(status).toBe(503);
    envObj.OPENROUTER_API_KEY = 'test-key';
  });
});
