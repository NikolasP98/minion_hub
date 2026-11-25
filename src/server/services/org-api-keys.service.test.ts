import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

/**
 * A recording fake for the few Drizzle chains this service uses: every awaited chain
 * pops the next queued result, and each call's method trail is kept for assertions.
 */
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
            (value instanceof Error ? Promise.reject(value) : Promise.resolve(value)).then(ok, bad);
        }
        return (...args: unknown[]) => chain([...trail, [prop, args]]);
      },
    });
  const handle = {
    select: (...a: unknown[]) => chain([['select', a]]),
    insert: (...a: unknown[]) => chain([['insert', a]]),
    update: (...a: unknown[]) => chain([['update', a]]),
  };
  return { queue, calls, handle };
});

const owner = vi.hoisted(() => ({ assertOwnerInTx: vi.fn() }));
vi.mock('./record-locks.service', () => owner);
vi.mock('$server/db/pg-client', () => ({ getCoreDb: () => db.handle }));
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (ctx: { db: unknown }, fn: (tx: unknown) => unknown) => fn(ctx.db),
}));

import {
  ACTIVE_KEY_LIMIT,
  ApiKeyError,
  KEY_RE,
  createKey,
  generateKey,
  hashKey,
  listKeys,
  revokeKey,
  touchKey,
  verifyKey,
} from './org-api-keys.service';

const ctx = { db: db.handle, tenantId: 'org-1', profileId: 'p-admin' } as never;
const dialect = new PgDialect();
const arg = (trail: Array<[string, unknown[]]>, method: string) =>
  trail.find(([m]) => m === method)?.[1][0];
const row = (over: Record<string, unknown> = {}) => ({
  id: 'k1',
  orgId: 'org-1',
  name: 'Site',
  prefix: '1a2b3c4d',
  keyHash: 'f'.repeat(64),
  createdBy: 'p-admin',
  createdAt: new Date('2026-11-16T10:00:00Z'),
  lastUsedAt: null,
  revokedBy: null,
  revokedAt: null,
  scopes: [],
  ...over,
});

beforeEach(() => {
  db.queue.length = 0;
  db.calls.length = 0;
});

describe('generateKey / hashKey', () => {
  it('draws mk_<8 hex>_<43 base64url>; the hash is SHA-256 hex and never the text', () => {
    const a = generateKey();
    const b = generateKey();
    expect(a.key).toMatch(KEY_RE);
    expect(a.key.startsWith(`mk_${a.prefix}_`)).toBe(true);
    expect(a.prefix).toMatch(/^[0-9a-f]{8}$/);
    expect(a.key).not.toBe(b.key);
    expect(hashKey(a.key)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashKey(a.key)).not.toContain(a.key);
    expect(hashKey(a.key)).toBe(hashKey(a.key));
  });
});

describe('createKey', () => {
  it('trims the name, stores prefix + hash only, and returns the text once', async () => {
    db.queue.push([{ n: 0 }]);
    db.queue.push([row({ name: 'Site' })]);
    db.queue.push([{ id: 'p-admin', displayName: 'Ada', email: 'ada@x' }]);
    const created = await createKey(ctx, '  Site  ');
    const inserted = arg(db.calls[1]!, 'values') as Record<string, unknown>;
    expect(inserted).toMatchObject({ orgId: 'org-1', name: 'Site', createdBy: 'p-admin' });
    expect(created.key).toMatch(KEY_RE);
    expect(created.key.startsWith(`mk_${inserted.prefix}_`)).toBe(true);
    expect(inserted.keyHash).toBe(hashKey(created.key));
    expect(JSON.stringify(inserted)).not.toContain(created.key);
    expect(created).toMatchObject({ id: 'k1', name: 'Site', createdByName: 'Ada' });
    expect(created).not.toHaveProperty('keyHash');
  });

  it('stores the requested scopes (deduplicated), none by default, and refuses unknown ones', async () => {
    db.queue.push([{ n: 0 }], [row({ scopes: ['sandbox'] })], []);
    const created = await createKey(ctx, 'Agent', ['sandbox', 'sandbox']);
    expect(arg(db.calls[1]!, 'values')).toMatchObject({ scopes: ['sandbox'] });
    expect(created.scopes).toEqual(['sandbox']);
    db.queue.push([{ n: 0 }], [row()], []);
    await createKey(ctx, 'Site');
    expect(arg(db.calls.at(-2)!, 'values')).toMatchObject({ scopes: [] });
    await expect(createKey(ctx, 'Bad', ['admin'])).rejects.toMatchObject({
      code: 'invalid_scope',
    });
  });

  it('accepts the locks scope (spec 140) alone or with sandbox', async () => {
    owner.assertOwnerInTx.mockResolvedValue('p-owner');
    db.queue.push([{ n: 0 }], [row({ scopes: ['locks'] })], []);
    const created = await createKey(ctx, 'Accounting', ['locks']);
    expect(arg(db.calls[1]!, 'values')).toMatchObject({ scopes: ['locks'] });
    expect(created.scopes).toEqual(['locks']);
    db.queue.push([{ n: 0 }], [row({ scopes: ['sandbox', 'locks'] })], []);
    await createKey(ctx, 'Both', ['sandbox', 'locks']);
    expect(arg(db.calls.at(-2)!, 'values')).toMatchObject({ scopes: ['sandbox', 'locks'] });
  });

  it('an admin cannot mint a locks key: owner_required, nothing inserted; an owner can', async () => {
    const { CorrectionError } = await import('./stock-corrections.logic');
    owner.assertOwnerInTx.mockRejectedValueOnce(
      new CorrectionError('owner only', 'owner_required'),
    );
    const callsBefore = db.calls.length;
    await expect(createKey(ctx, 'Accounting', ['locks'])).rejects.toMatchObject({
      code: 'owner_required',
    });
    expect(db.calls.length).toBe(callsBefore);
    owner.assertOwnerInTx.mockResolvedValueOnce('p-owner');
    db.queue.push([{ n: 0 }], [row({ scopes: ['locks'] })], []);
    expect((await createKey(ctx, 'Accounting', ['locks'])).scopes).toEqual(['locks']);
  });

  it('keys without the locks scope never need an owner', async () => {
    owner.assertOwnerInTx.mockClear();
    db.queue.push([{ n: 0 }], [row({ scopes: ['sandbox'] })], []);
    await createKey(ctx, 'Agent', ['sandbox']);
    expect(owner.assertOwnerInTx).not.toHaveBeenCalled();
  });

  it('refuses an empty or over-60 name before any query', async () => {
    await expect(createKey(ctx, '   ')).rejects.toMatchObject({ code: 'invalid_name' });
    await expect(createKey(ctx, 'x'.repeat(61))).rejects.toMatchObject({ code: 'invalid_name' });
    expect(db.calls).toHaveLength(0);
  });

  it('refuses the eleventh active key', async () => {
    db.queue.push([{ n: ACTIVE_KEY_LIMIT }]);
    const err = await createKey(ctx, 'One more').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiKeyError);
    expect((err as ApiKeyError).code).toBe('limit_reached');
    expect(db.calls.some((t) => t[0]![0] === 'insert')).toBe(false);
  });

  it('re-draws in a fresh transaction when the prefix is taken (driver code on .cause)', async () => {
    const taken = Object.assign(new Error('insert failed'), { cause: { code: '23505' } });
    db.queue.push([{ n: 3 }], taken, [{ n: 3 }], [row()], []);
    await createKey(ctx, 'Site');
    const inserts = db.calls.filter((t) => t[0]![0] === 'insert');
    expect(inserts).toHaveLength(2);
    const [first, second] = inserts.map((t) => (arg(t, 'values') as { prefix: string }).prefix);
    expect(first).not.toBe(second);
  });

  it('gives up after three collisions and rethrows any other failure', async () => {
    const taken = Object.assign(new Error('dup'), { code: '23505' });
    db.queue.push([{ n: 0 }], taken, [{ n: 0 }], taken, [{ n: 0 }], taken);
    await expect(createKey(ctx, 'Site')).rejects.toBe(taken);
    db.queue.length = 0;
    const other = new Error('down');
    db.queue.push([{ n: 0 }], other);
    await expect(createKey(ctx, 'Site')).rejects.toBe(other);
  });
});

describe('listKeys', () => {
  it('returns names and dates, never the hash; a person who is gone is null', async () => {
    db.queue.push([
      row({ id: 'k1', revokedAt: new Date('2026-11-16T12:00:00Z'), revokedBy: 'p-gone' }),
      row({ id: 'k2', createdBy: null, lastUsedAt: new Date('2026-11-16T11:00:00Z') }),
    ]);
    db.queue.push([{ id: 'p-admin', displayName: '', email: 'ada@x' }]);
    const keys = await listKeys(ctx);
    expect(JSON.stringify(keys)).not.toMatch(/keyHash|ffff/);
    expect(keys).toEqual([
      {
        id: 'k1',
        name: 'Site',
        prefix: '1a2b3c4d',
        createdAt: '2026-11-16T10:00:00.000Z',
        createdByName: 'ada@x',
        lastUsedAt: null,
        revokedAt: '2026-11-16T12:00:00.000Z',
        revokedByName: null,
        scopes: [],
      },
      expect.objectContaining({
        id: 'k2',
        createdByName: null,
        lastUsedAt: '2026-11-16T11:00:00.000Z',
      }),
    ]);
  });
});

describe('revokeKey', () => {
  const ID = '11111111-2222-4333-8444-555555555555';

  it('revokes an active key with the acting person, only while it is not revoked', async () => {
    db.queue.push([{ id: ID, revokedAt: null }], []);
    await revokeKey(ctx, ID);
    const update = db.calls[1]!;
    expect(update[0]![0]).toBe('update');
    expect(arg(update, 'set')).toMatchObject({ revokedBy: 'p-admin', revokedAt: expect.any(Date) });
    expect(dialect.sqlToQuery(arg(update, 'where') as SQL).sql).toMatch(/"revoked_at" is null/);
  });

  it('is idempotent: a revoked key is left as it is', async () => {
    db.queue.push([{ id: ID, revokedAt: new Date() }]);
    await revokeKey(ctx, ID);
    expect(db.calls).toHaveLength(1);
  });

  it('an unknown or foreign id is not_found; a non-UUID id is refused before any query', async () => {
    db.queue.push([]);
    await expect(revokeKey(ctx, ID)).rejects.toMatchObject({ code: 'not_found' });
    db.calls.length = 0;
    await expect(revokeKey(ctx, 'not-a-uuid')).rejects.toMatchObject({ code: 'not_found' });
    expect(db.calls).toHaveLength(0);
  });
});

describe('verifyKey', () => {
  const { key, prefix } = generateKey();

  it('malformed text returns null without a query', async () => {
    for (const text of [
      '',
      'mk_',
      `mk_${prefix}_short`,
      `MK_${prefix}_${'a'.repeat(43)}`,
      'Basic x',
    ])
      expect(await verifyKey(text)).toBeNull();
    expect(db.calls).toHaveLength(0);
  });

  it('finds the key by prefix and compares the hash', async () => {
    const used = new Date('2026-11-16T09:00:00Z');
    db.queue.push([
      {
        id: 'k1',
        orgId: 'org-1',
        name: 'Site',
        keyHash: hashKey(key),
        lastUsedAt: used,
        revokedAt: null,
        scopes: ['sandbox'],
      },
    ]);
    expect(await verifyKey(key)).toEqual({
      id: 'k1',
      orgId: 'org-1',
      name: 'Site',
      lastUsedAt: used,
      scopes: ['sandbox'],
    });
    const where = arg(db.calls[0]!, 'where') as SQL;
    expect(dialect.sqlToQuery(where).params).toEqual([prefix]);
  });

  it('a wrong secret with a known prefix, an unknown prefix and a revoked key are all null', async () => {
    db.queue.push([
      { id: 'k1', orgId: 'org-1', keyHash: hashKey(key), lastUsedAt: null, revokedAt: null },
    ]);
    expect(await verifyKey(key.slice(0, -1) + (key.endsWith('A') ? 'B' : 'A'))).toBeNull();
    db.queue.push([]);
    expect(await verifyKey(key)).toBeNull();
    db.queue.push([
      { id: 'k1', orgId: 'org-1', keyHash: hashKey(key), lastUsedAt: null, revokedAt: new Date() },
    ]);
    expect(await verifyKey(key)).toBeNull();
  });
});

describe('touchKey', () => {
  it('is one conditional update: never used, or last used over a minute ago', async () => {
    await touchKey('k1');
    expect(db.calls).toHaveLength(1);
    const q = dialect.sqlToQuery(arg(db.calls[0]!, 'where') as SQL);
    expect(q.sql).toMatch(
      /"last_used_at" is null or "org_api_keys"\."last_used_at" < now\(\) - interval '1 minute'/,
    );
    expect(q.params).toEqual(['k1']);
  });
});
