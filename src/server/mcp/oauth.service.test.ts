import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Recording fake for the Drizzle chains used here: each awaited chain pops the next result. */
const db = vi.hoisted(() => {
  const queue: unknown[] = [];
  const calls: Array<Array<[string, unknown[]]>> = [];
  const chain = (trail: Array<[string, unknown[]]>): unknown =>
    new Proxy(() => {}, {
      get(_t, prop: string) {
        if (prop === 'then') {
          calls.push(trail);
          const value = queue.length ? queue.shift() : [];
          return (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) =>
            Promise.resolve(value).then(ok, bad);
        }
        return (...args: unknown[]) => chain([...trail, [prop, args]]);
      },
    });
  const handle: Record<string, unknown> = {
    select: (...a: unknown[]) => chain([['select', a]]),
    insert: (...a: unknown[]) => chain([['insert', a]]),
    update: (...a: unknown[]) => chain([['update', a]]),
  };
  handle.transaction = (fn: (tx: unknown) => unknown) => fn(handle);
  return { queue, calls, handle };
});
vi.mock('$server/db/pg-client', () => ({ getCoreDb: () => db.handle }));

import { hashSecret } from './oauth-logic';
import {
  createCode,
  endConnection,
  exchangeCode,
  findAccess,
  refresh,
  registerClient,
} from './oauth.service';

const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const codeRow = {
  clientId: 'mcpc_a',
  userId: 'u1',
  orgId: 'org-1',
  redirectUri: 'http://localhost:1234/cb',
  codeChallenge: CHALLENGE,
};
const exchange = (over: Partial<Parameters<typeof exchangeCode>[0]> = {}) =>
  exchangeCode({
    code: 'mcp_ac_x',
    clientId: 'mcpc_a',
    redirectUri: 'http://localhost:1234/cb',
    verifier: VERIFIER,
    ...over,
  });
const inserts = () => db.calls.filter((t) => t[0]![0] === 'insert');
const valuesOf = (trail: Array<[string, unknown[]]>) => trail.find((s) => s[0] === 'values')![1][0];

beforeEach(() => {
  db.queue.length = 0;
  db.calls.length = 0;
});

describe('registerClient / createCode', () => {
  it('registers with a generated id and returns it', async () => {
    const { id } = await registerClient(' Claude ', ['http://localhost/cb'], '1.2.3.4');
    expect(id).toMatch(/^mcpc_[A-Za-z0-9_-]{24}$/);
    expect(valuesOf(inserts()[0]!)).toMatchObject({ name: 'Claude', createdIp: '1.2.3.4' });
  });

  it('stores only the hash of a code and expires it in 60 seconds', async () => {
    const code = await createCode({
      clientId: 'mcpc_a',
      userId: 'u1',
      orgId: 'org-1',
      redirectUri: 'http://localhost/cb',
      codeChallenge: CHALLENGE,
    });
    const stored = valuesOf(inserts()[0]!) as { hash: string; expiresAt: Date };
    expect(code).toMatch(/^mcp_ac_/);
    expect(stored.hash).toBe(hashSecret(code));
    expect(JSON.stringify(stored)).not.toContain(code);
    expect(stored.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(60_000);
  });
});

describe('exchangeCode', () => {
  it('spends the code, opens one connection and issues a hashed access + renewal pair', async () => {
    db.queue.push([codeRow], [{ id: 'conn-1' }], [], []);
    const pair = await exchange();
    expect(pair).toMatchObject({ token_type: 'Bearer', expires_in: 3600 });
    expect(pair!.access_token).toMatch(/^mcp_at_/);
    expect(pair!.refresh_token).toMatch(/^mcp_rt_/);
    const [conn, creds] = inserts();
    expect(valuesOf(conn!)).toMatchObject({ userId: 'u1', clientId: 'mcpc_a', orgId: 'org-1' });
    const rows = valuesOf(creds!) as Array<{ hash: string; kind: string; connectionId: string }>;
    expect(rows.map((r) => r.kind)).toEqual(['access', 'refresh']);
    expect(rows[0]!.hash).toBe(hashSecret(pair!.access_token));
    expect(rows[1]!.hash).toBe(hashSecret(pair!.refresh_token));
    expect(rows.every((r) => r.connectionId === 'conn-1')).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(pair!.access_token);
  });

  it('refuses a code already used, unknown or expired (the conditional update finds nothing)', async () => {
    db.queue.push([], []);
    expect(await exchange()).toBeNull();
    expect(inserts()).toHaveLength(0);
  });

  it('the spend is its own statement: a failed check runs no transaction work (P3)', async () => {
    db.queue.push([codeRow]);
    expect(await exchange({ verifier: VERIFIER.replace('d', 'e') })).toBeNull();
    expect(db.calls).toHaveLength(1);
  });

  it('a spent code presented again ends the connection it opened (P11)', async () => {
    db.queue.push([], [{ connectionId: 'conn-1', usedAt: new Date() }], []);
    expect(await exchange()).toBeNull();
    expect(db.calls.filter((t) => t[0]![0] === 'update')).toHaveLength(2); // spend attempt, end
  });

  it('the connection id is written back onto the code at exchange (P11)', async () => {
    db.queue.push([codeRow], [{ id: 'conn-1' }], [], []);
    await exchange();
    const back = db.calls.filter((t) => t[0]![0] === 'update')[1]!;
    expect(back.find((s) => s[0] === 'set')![1][0]).toEqual({ connectionId: 'conn-1' });
  });

  it.each([
    ['wrong verifier', { verifier: VERIFIER.replace('d', 'e') }],
    ['wrong client', { clientId: 'mcpc_b' }],
    ['wrong redirect', { redirectUri: 'http://localhost:1234/other' }],
  ])('refuses a %s and issues nothing (the code stays spent)', async (_n, over) => {
    db.queue.push([codeRow]);
    expect(await exchange(over)).toBeNull();
    expect(inserts()).toHaveLength(0);
  });
});

describe('refresh', () => {
  const live = { connectionId: 'conn-1', clientId: 'mcpc_a', userId: 'u1', orgId: 'org-1' };

  it('rotates: spends the old credential and issues a new pair on the same connection', async () => {
    db.queue.push([live], []);
    const pair = await refresh({ token: 'mcp_rt_old', clientId: 'mcpc_a' });
    expect(pair!.refresh_token).not.toBe('mcp_rt_old');
    const rows = valuesOf(inserts()[0]!) as Array<{ connectionId: string }>;
    expect(rows.every((r) => r.connectionId === 'conn-1')).toBe(true);
  });

  it('a renewal credential used again within 60 s gets a fresh pair and keeps the connection (P2)', async () => {
    db.queue.push([], [{ ...live, usedAt: new Date(), recent: true }], [{ id: 'conn-1' }], []);
    const pair = await refresh({ token: 'mcp_rt_old', clientId: 'mcpc_a' });
    expect(pair!.access_token).toMatch(/^mcp_at_/);
    expect(db.calls.filter((t) => t[0]![0] === 'update')).toHaveLength(1);
  });

  it('a renewal credential reused after the grace ends the connection and answers nothing', async () => {
    db.queue.push([], [{ ...live, usedAt: new Date(), recent: false }], []);
    expect(await refresh({ token: 'mcp_rt_old', clientId: 'mcpc_a' })).toBeNull();
    const update = db.calls.filter((t) => t[0]![0] === 'update');
    expect(update).toHaveLength(2); // spend attempt, then end the connection
    expect(inserts()).toHaveLength(0);
  });

  it('an unknown credential changes nothing', async () => {
    db.queue.push([], []);
    expect(await refresh({ token: 'mcp_rt_nope', clientId: 'mcpc_a' })).toBeNull();
    expect(db.calls.filter((t) => t[0]![0] === 'update')).toHaveLength(1);
  });

  it('an ended connection cannot renew', async () => {
    // The connection test is part of the spend statement, so nothing is spent and nothing issued.
    db.queue.push([], [{ ...live, usedAt: null, recent: null }]);
    expect(await refresh({ token: 'mcp_rt_old', clientId: 'mcpc_a' })).toBeNull();
    expect(inserts()).toHaveLength(0);
  });

  it('another app cannot renew it, and burns nothing (the client is in the spend where)', async () => {
    db.queue.push([], []);
    expect(await refresh({ token: 'mcp_rt_old', clientId: 'mcpc_b' })).toBeNull();
    expect(inserts()).toHaveLength(0);
    expect(db.calls.filter((t) => t[0]![0] === 'update')).toHaveLength(1);
  });
});

describe('findAccess / endConnection', () => {
  it('finds the live connection of an access credential, null otherwise', async () => {
    const hit = { connectionId: 'c', userId: 'u', orgId: 'o', lastUsedAt: null };
    db.queue.push([hit], []);
    expect(await findAccess('mcp_at_x')).toEqual(hit);
    expect(await findAccess('mcp_at_y')).toBeNull();
  });

  it('end reports whether a live connection in scope was ended', async () => {
    db.queue.push([{ id: 'c' }], []);
    expect(await endConnection('c', 'u1', { userId: 'u1' })).toBe(true);
    expect(await endConnection('c', 'u1', { userId: 'u1' })).toBe(false);
  });
});
