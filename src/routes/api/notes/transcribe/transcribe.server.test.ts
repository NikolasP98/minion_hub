import { describe, it, expect, vi, beforeEach } from 'vitest';

const envObj: Record<string, string> = {};
vi.mock('$env/dynamic/private', () => ({ env: new Proxy(envObj, { get: (t, p) => t[p as string] }) }));

const gatewayCall = vi.fn<() => Promise<{ text?: string }>>();
vi.mock('$lib/server/gateway-rpc', () => ({ gatewayCall: () => gatewayCall() }));

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
});

describe('POST /api/notes/transcribe', () => {
  it('forwards audio to the gateway media.transcribe and returns the text', async () => {
    gatewayCall.mockResolvedValue({ text: 'hello world' });
    const res = await callForm(audioForm());
    expect(await res.json()).toEqual({ text: 'hello world' });
    expect(gatewayCall).toHaveBeenCalledTimes(1);
  });

  it('400s when no file is provided', async () => {
    expect(await statusOf(callForm(new FormData()))).toBe(400);
    expect(gatewayCall).not.toHaveBeenCalled();
  });

  it('401s when unauthenticated', async () => {
    expect(await statusOf(callForm(audioForm(), false))).toBe(401);
    expect(gatewayCall).not.toHaveBeenCalled();
  });

  it('returns empty text for an empty chunk without calling the gateway', async () => {
    const fd = new FormData();
    fd.append('file', new File([], 'chunk.webm', { type: 'audio/webm' }));
    const res = await callForm(fd);
    expect(await res.json()).toEqual({ text: '' });
    expect(gatewayCall).not.toHaveBeenCalled();
  });

  it('502s when the gateway transcription is unavailable', async () => {
    gatewayCall.mockRejectedValue(new Error('gateway down'));
    expect(await statusOf(callForm(audioForm()))).toBe(502);
  });
});
