import { describe, it, expect, vi, beforeEach } from 'vitest';

// Slice 1 baseline (specs/2026-08-18-hub-updateserver-tenant-scope-spec.md).
// Pins updateServer's CURRENT contract — it updates a row by `id` alone, with
// no `servers.tenantId` predicate and no not-found signal — so Slice 2's
// tenant-scoped predicate change has a proven "before" to diff against.
// Split from server.service.test.ts (mirrors the pos.tickets.test.ts /
// pos.sellables.test.ts per-concern split of pos.service.ts) because it needs
// a real filtering in-memory `servers` table instead of the shared
// createMockDb chain-recorder, which never inspects `.where()` predicates.

vi.mock('$server/db/utils', () => ({
  newId: () => 'unused-in-update-tests',
  nowMs: () => 1_700_000_000_000,
}));

// Real column objects would need the real @minion-stack/db/schema sqliteTable
// machinery; the in-memory store below only needs stable string keys, mirrored
// by the drizzle-orm eq/and mock so `eq(servers.tenantId, x)` filters on the
// `tenantId` property of a plain row object.
vi.mock('@minion-stack/db/schema', () => ({
  servers: {
    id: 'id',
    tenantId: 'tenantId',
    name: 'name',
    url: 'url',
    token: 'token',
    tokenIv: 'tokenIv',
    authMode: 'authMode',
    lastConnectedAt: 'lastConnectedAt',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
  userServers: { userId: 'userId', serverId: 'serverId', createdAt: 'createdAt' },
}));

vi.mock('drizzle-orm', () => ({
  eq: (col: string, val: unknown) => (r: Record<string, unknown>) => r[col] === val,
  and:
    (...fns: Array<(r: Record<string, unknown>) => boolean>) =>
    (r: Record<string, unknown>) =>
      fns.every((f) => f(r)),
}));

import { updateServer } from './server.service';

type ServerRow = {
  id: string;
  tenantId: string;
  name: string;
  url: string;
  token: string;
  tokenIv: string;
  authMode: string;
  lastConnectedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

// Fixture: two tenants, one server each, distinct ids — the same shape
// Slice 2's cross-tenant regression test will reuse.
function seedRows(): ServerRow[] {
  return [
    {
      id: 'server-a',
      tenantId: 'tenant-a',
      name: 'Tenant A host',
      url: 'https://a.example.com',
      token: '',
      tokenIv: '',
      authMode: 'token',
      lastConnectedAt: null,
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'server-b',
      tenantId: 'tenant-b',
      name: 'Tenant B host',
      url: 'https://b.example.com',
      token: '',
      tokenIv: '',
      authMode: 'token',
      lastConnectedAt: null,
      createdAt: 1,
      updatedAt: 1,
    },
  ];
}

let rows: ServerRow[];

function makeDb() {
  return {
    update: () => ({
      set: (patch: Partial<ServerRow>) => ({
        where: (whereFn: (r: Record<string, unknown>) => boolean) => {
          rows = rows.map((r) =>
            whereFn(r as unknown as Record<string, unknown>) ? { ...r, ...patch } : r,
          );
          return Promise.resolve(undefined);
        },
      }),
    }),
  };
}

beforeEach(() => {
  rows = seedRows();
});

const ctxFor = (tenantId: string) => ({ db: makeDb() as never, tenantId });

describe('updateServer — Slice 1 baseline (pre tenant-scope)', () => {
  it('same-tenant update: patches the caller tenant’s own server row', async () => {
    await updateServer(ctxFor('tenant-a'), 'server-a', { name: 'Renamed A' });

    const a = rows.find((r) => r.id === 'server-a');
    const b = rows.find((r) => r.id === 'server-b');
    expect(a?.name).toBe('Renamed A');
    expect(a?.updatedAt).toBe(1_700_000_000_000);
    expect(b).toEqual(seedRows()[1]);
  });

  it('unknown id: resolves undefined (no not-found signal) and mutates nothing', async () => {
    await expect(
      updateServer(ctxFor('tenant-a'), 'does-not-exist', { name: 'X' }),
    ).resolves.toBeUndefined();
    expect(rows).toEqual(seedRows());
  });
});
