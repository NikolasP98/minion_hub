import { describe, it, expect, vi, beforeEach } from 'vitest';

const envObj: Record<string, string> = { OPENAI_API_KEY: 'sk-test' };
vi.mock('$env/dynamic/private', () => ({ env: new Proxy(envObj, { get: (t, p) => t[p as string] }) }));

function makeLocals(auth = true): App.Locals {
  return {
    user: auth ? { id: 'u1', email: 't@t.com', displayName: 'T', role: 'user' } : undefined,
  } as App.Locals;
}

function callForm(form: FormData, auth = true) {
  return import('./+server').then(({ POST }) =>
    POST({
      locals: makeLocals(auth),
      request: new Request('http://x/api/notes/transcribe', { method: 'POST', body: form }),
    } as Parameters<typeof POST>[0]),
  );
}

function audioForm(bytes = 5000): FormData {
  const fd = new FormData();
  fd.append('file', new File([new Uint8Array(bytes)], 'chunk.webm', { type: 'audio/webm' }));
  return fd;
}

async function statusOf(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 0;
  } catch (e) {
    return (e as { status?: number }).status ?? -1;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  envObj.OPENAI_API_KEY = 'sk-test';
});

describe('POST /api/notes/transcribe', () => {
  it('forwards audio to OpenAI and returns the text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: 'hello world' }), { status: 200 })),
    );
    const res = await callForm(audioForm());
    expect(await res.json()).toEqual({ text: 'hello world' });
  });

  it('503s when no transcription key is configured', async () => {
    delete envObj.OPENAI_API_KEY;
    vi.stubGlobal('fetch', vi.fn());
    expect(await statusOf(callForm(audioForm()))).toBe(503);
  });

  it('400s when no file is provided', async () => {
    vi.stubGlobal('fetch', vi.fn());
    expect(await statusOf(callForm(new FormData()))).toBe(400);
  });

  it('401s when unauthenticated', async () => {
    vi.stubGlobal('fetch', vi.fn());
    expect(await statusOf(callForm(audioForm(), false))).toBe(401);
  });

  it('returns empty text for an empty chunk without calling OpenAI', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const fd = new FormData();
    fd.append('file', new File([], 'chunk.webm', { type: 'audio/webm' }));
    const res = await callForm(fd);
    expect(await res.json()).toEqual({ text: '' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
