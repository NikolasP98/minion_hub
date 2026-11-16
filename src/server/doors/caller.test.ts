import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  limit: vi.fn(async (_key: string, _limit: number) => true),
  verifyKey: vi.fn(),
  touchKey: vi.fn(async (_id: string) => undefined),
  doorRows: [] as Array<{ orgId: string }>,
  doorReads: 0,
}));

vi.mock('$server/auth/shared-rate-limit', () => ({
  checkSharedRateLimit: (key: string, limit: number) => mocks.limit(key, limit),
}));
vi.mock('$server/services/org-api-keys.service', () => ({
  verifyKey: (text: string) => mocks.verifyKey(text),
  touchKey: (id: string) => mocks.touchKey(id),
}));
// The door read is `select … from crm_doors … limit 1`: any chain resolves to the queued rows.
vi.mock('$server/db/pg-client', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where']) chain[m] = () => chain;
  chain.limit = async () => {
    mocks.doorReads++;
    return mocks.doorRows;
  };
  return { getCoreDb: () => chain };
});

import { doorCaller } from './caller';

const KEY = `mk_1a2b3c4d_${'A'.repeat(43)}`;
const event = (authorization?: string, ip = '203.0.113.7') => ({
  request: new Request('http://hub.test/api/doors/public/qa-intake/submit', {
    method: 'POST',
    headers: authorization ? { authorization } : {},
  }),
  getClientAddress: () => ip,
});
const status = async (r: Response | { keyId: string | null }) =>
  r instanceof Response ? { status: r.status, body: await r.json() } : r;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockResolvedValue(true);
  mocks.doorRows = [{ orgId: 'org-1' }];
  mocks.doorReads = 0;
  mocks.verifyKey.mockResolvedValue({ id: 'k1', orgId: 'org-1', lastUsedAt: null });
});

describe('doorCaller', () => {
  it('no header → exactly the limiter call of before, and nothing else', async () => {
    expect(await doorCaller(event(), 'qa-intake', 'submit')).toEqual({ keyId: null });
    expect(await doorCaller(event(), 'qa-intake', 'upload')).toEqual({ keyId: null });
    expect(mocks.limit.mock.calls).toEqual([
      ['door-submit:203.0.113.7:qa-intake', 5],
      ['door-upload:203.0.113.7:qa-intake', 40],
    ]);
    expect(mocks.verifyKey).not.toHaveBeenCalled();
    expect(mocks.doorReads).toBe(0);
  });

  it('over the address limit → 429 too_many; an unknown address falls back to "unknown"', async () => {
    mocks.limit.mockResolvedValueOnce(false);
    expect(await status(await doorCaller(event(), 'qa-intake', 'submit'))).toEqual({
      status: 429,
      body: { error: 'too_many' },
    });
    const noIp = {
      ...event(),
      getClientAddress: () => {
        throw new Error('no address');
      },
    };
    await doorCaller(noIp, 'qa-intake', 'submit');
    expect(mocks.limit).toHaveBeenLastCalledWith('door-submit:unknown:qa-intake', 5);
  });

  it('another Authorization kind, or a Bearer that is not mk_, is treated as no key', async () => {
    for (const h of ['Basic dXNlcjpwYXNz', 'Bearer eyJhbGciOi', `bearer ${KEY}`])
      expect(await doorCaller(event(h), 'qa-intake', 'submit')).toEqual({ keyId: null });
    expect(mocks.verifyKey).not.toHaveBeenCalled();
    expect(mocks.limit).toHaveBeenCalledTimes(3);
  });

  it('malformed, unknown or revoked key → 401, no door read and no limit counted', async () => {
    mocks.verifyKey.mockResolvedValue(null);
    for (const h of ['Bearer mk_short', `Bearer ${KEY}`])
      expect(await status(await doorCaller(event(h), 'qa-intake', 'submit'))).toEqual({
        status: 401,
        body: { error: 'unauthorized' },
      });
    expect(mocks.verifyKey).toHaveBeenCalledWith('mk_short');
    expect(mocks.doorReads).toBe(0);
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it('a key of another organization than the door → 401 and no limiter call', async () => {
    mocks.doorRows = [{ orgId: 'org-2' }];
    expect(await status(await doorCaller(event(`Bearer ${KEY}`), 'qa-intake', 'upload'))).toEqual({
      status: 401,
      body: { error: 'unauthorized' },
    });
    expect(mocks.limit).not.toHaveBeenCalled();
    expect(mocks.touchKey).not.toHaveBeenCalled();
  });

  it('an unknown slug with a valid key continues (the service answers 404)', async () => {
    mocks.doorRows = [];
    expect(await doorCaller(event(`Bearer ${KEY}`), 'nope', 'submit')).toEqual({ keyId: 'k1' });
  });

  it('a valid key counts only against the key: 60 submissions, 240 uploads', async () => {
    expect(await doorCaller(event(`Bearer ${KEY}`), 'qa-intake', 'submit')).toEqual({
      keyId: 'k1',
    });
    await doorCaller(event(`Bearer ${KEY}`), 'qa-intake', 'upload');
    expect(mocks.limit.mock.calls).toEqual([
      ['door-key-submit:k1', 60],
      ['door-key-upload:k1', 240],
    ]);
    mocks.limit.mockResolvedValueOnce(false);
    expect(await status(await doorCaller(event(`Bearer ${KEY}`), 'qa-intake', 'submit'))).toEqual({
      status: 429,
      body: { error: 'too_many' },
    });
  });

  it('touches the key only when it was never used or over a minute ago', async () => {
    await doorCaller(event(`Bearer ${KEY}`), 'qa-intake', 'submit');
    expect(mocks.touchKey).toHaveBeenCalledWith('k1');
    vi.clearAllMocks();
    mocks.verifyKey.mockResolvedValue({ id: 'k1', orgId: 'org-1', lastUsedAt: new Date() });
    await doorCaller(event(`Bearer ${KEY}`), 'qa-intake', 'submit');
    expect(mocks.touchKey).not.toHaveBeenCalled();
    mocks.verifyKey.mockResolvedValue({
      id: 'k1',
      orgId: 'org-1',
      lastUsedAt: new Date(Date.now() - 61_000),
    });
    await doorCaller(event(`Bearer ${KEY}`), 'qa-intake', 'submit');
    expect(mocks.touchKey).toHaveBeenCalledOnce();
  });

  it('the key text appears in no console call', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) =>
      vi.spyOn(console, k).mockImplementation(() => {}),
    );
    await doorCaller(event(`Bearer ${KEY}`), 'qa-intake', 'submit');
    mocks.verifyKey.mockResolvedValue(null);
    await doorCaller(event(`Bearer ${KEY}`), 'qa-intake', 'submit');
    mocks.verifyKey.mockRejectedValue(new Error('db down'));
    await doorCaller(event(`Bearer ${KEY}`), 'qa-intake', 'submit').catch(() => {});
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(KEY.slice(12));
      spy.mockRestore();
    }
  });
});
