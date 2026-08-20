import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  upsertServer,
  listServers,
  deleteServer,
  getServerToken,
  updateServer,
} from './server.service';
import {
  EVIDENCE_RELATIVE_PATH,
  rekeyReadinessGateFailures,
  rekeyReadinessReport,
  updateServerIsTenantScoped,
} from '../../../scripts/audit-server-tenant-scope.lib';
import { createMockDb } from '$server/test-utils/mock-db';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const EVIDENCE_PATH = path.join(REPO_ROOT, EVIDENCE_RELATIVE_PATH);

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock('$server/db/utils', () => ({
  newId: () => 'mock-server-id-00000001',
  nowMs: () => 1_700_000_000_000,
}));

// updateServer's Slice 1 baseline tests (specs/2026-08-18-hub-updateserver-tenant-scope-spec.md)
// need a real filtering in-memory `servers` table instead of the createMockDb chain-recorder
// above, which never inspects `.where()` predicates. Real column objects would need the real
// @minion-stack/db/schema sqliteTable machinery, so the mock below only needs stable string
// keys, mirrored by the drizzle-orm eq/and mock so `eq(servers.tenantId, x)` filters on the
// `tenantId` property of a plain row object. createMockDb-based tests above are unaffected
// since they ignore the actual column/predicate values passed through the chain.
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

describe('upsertServer', () => {
  it('calls db.insert and returns an id', async () => {
    const { db } = createMockDb();
    const id = await upsertServer(
      { db, tenantId: 't1' },
      { name: 'srv', url: 'http://localhost', token: 'tok' },
    );
    expect(id).toBe('mock-server-id-00000001');
    expect(db.insert).toHaveBeenCalled();
  });

  it('uses provided id when given', async () => {
    const { db } = createMockDb();
    const id = await upsertServer(
      { db, tenantId: 't1' },
      { id: 'existing-id', name: 'srv', url: 'http://localhost', token: 'tok' },
    );
    expect(id).toBe('existing-id');
  });
});

describe('listServers', () => {
  it('returns [] for anonymous callers (no userId, not admin)', async () => {
    const { db } = createMockDb();
    const result = await listServers({ db, tenantId: 't1' });
    expect(result).toEqual([]);
    // Importantly: did not query the DB at all.
    expect(db.select).not.toHaveBeenCalled();
  });

  it('returns rows without token fields for admin', async () => {
    const { db, resolve } = createMockDb();
    const mockServers = [{ id: 's1', name: 'test', url: 'http://x', lastConnectedAt: null }];
    resolve(mockServers);
    const result = await listServers({ db, tenantId: 't1' }, undefined, 'admin');
    expect(result).toEqual(mockServers);
    for (const row of result as Array<Record<string, unknown>>) {
      expect(row).not.toHaveProperty('token');
      expect(row).not.toHaveProperty('tokenIv');
    }
  });

  it('joins user_servers for non-admin users', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 's1', name: 'mine', url: 'http://x', lastConnectedAt: null }]);
    const result = await listServers({ db, tenantId: 't1' }, 'u1', 'user');
    expect(result).toHaveLength(1);
    expect(db.select).toHaveBeenCalled();
  });
});

describe('deleteServer', () => {
  it('calls db.delete', async () => {
    const { db } = createMockDb();
    await deleteServer({ db, tenantId: 't1' }, 's1');
    expect(db.delete).toHaveBeenCalled();
  });
});

// Slice 1 baseline (specs/2026-08-18-hub-updateserver-tenant-scope-spec.md).
// Pins updateServer's CURRENT contract — it updates a row by `id` alone, with
// no `servers.tenantId` predicate and no not-found signal — so Slice 2's
// tenant-scoped predicate change has a proven "before" to diff against.
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

let updateServerRows: ServerRow[];

function makeUpdateServerDb() {
  return {
    update: () => ({
      set: (patch: Partial<ServerRow>) => ({
        where: (whereFn: (r: Record<string, unknown>) => boolean) => {
          updateServerRows = updateServerRows.map((r) =>
            whereFn(r as unknown as Record<string, unknown>) ? { ...r, ...patch } : r,
          );
          return Promise.resolve(undefined);
        },
      }),
    }),
  };
}

const updateServerCtxFor = (tenantId: string) => ({ db: makeUpdateServerDb() as never, tenantId });

/**
 * Drive the shipped `updateServer` twice against the two-tenant table and report
 * which rows actually moved.
 *
 * This is the gate's primary input, and it is deliberately not a source scan.
 * "Is the mutation tenant-scoped?" answered by searching `updateServer`'s text
 * for `servers.tenantId` says yes to a comment, a log line, an assignment into
 * the `set` object, or a tenant-scoped read that happens to sit above an UPDATE
 * still keyed on `servers.id` alone — every one of which leaves the cross-tenant
 * write reachable. Running the function and looking at the rows cannot be
 * fooled that way: the fake `db` here applies the real predicate the service
 * builds (the `drizzle-orm` `eq`/`and` mock at the top of this file turns it
 * into a row predicate), so what is observed is what the database would do.
 */
async function probeUpdateServerTenantScope(): Promise<{
  sameTenantPatched: boolean;
  crossTenantPatched: boolean;
  bystanderRow: ServerRow | undefined;
}> {
  updateServerRows = seedRows();
  await updateServer(updateServerCtxFor('tenant-a'), 'server-a', { name: 'Renamed A' });
  const own = updateServerRows.find((r) => r.id === 'server-a');
  const bystanderRow = updateServerRows.find((r) => r.id === 'server-b');

  updateServerRows = seedRows();
  await updateServer(updateServerCtxFor('tenant-a'), 'server-b', { name: 'Renamed by A' });
  const foreign = updateServerRows.find((r) => r.id === 'server-b');

  return {
    sameTenantPatched: own?.name === 'Renamed A' && own?.updatedAt === 1_700_000_000_000,
    crossTenantPatched: foreign?.name === 'Renamed by A',
    bystanderRow,
  };
}

const SERVICE_SOURCE_PATH = path.join(REPO_ROOT, 'src/server/services/server.service.ts');

function recordedEvidence(): unknown {
  return existsSync(EVIDENCE_PATH) ? JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8')) : undefined;
}

describe('updateServer tenant scope (specs/2026-08-18-hub-updateserver-tenant-scope-spec.md)', () => {
  beforeEach(() => {
    updateServerRows = seedRows();
  });

  it('always lets a caller patch their own tenant’s server row', async () => {
    const observed = await probeUpdateServerTenantScope();

    // Not conditional on anything: whatever Slice 2 does to the predicate, a
    // tenant updating its own host must keep working. This is the assertion
    // that catches the failure mode the spec parked Slice 2 over — a predicate
    // that matches nothing and silently no-ops every legitimate update.
    expect(observed.sameTenantPatched).toBe(true);
    expect(observed.bystanderRow).toEqual(seedRows()[1]);
  });

  /**
   * The stop rule, asserted against behaviour.
   *
   * While `tests/rekey-readiness/evidence.json` is incomplete the cross-tenant
   * write is expected to still land — that is the parked defect, pinned rather
   * than described: `updateServer` matches on `servers.id` alone and
   * `assertOwnsOrAdmin()` in `src/routes/api/servers/[id]/+server.ts` returns
   * true for ANY admin, so an admin of tenant-a who supplies tenant-b's server
   * id patches that row and receives `ok`.
   *
   * The moment a credential holder records both passing audits and the re-key
   * record, this same assertion flips and demands the opposite: complete
   * evidence with a mutation that still writes across tenants is a failure, so
   * the evidence landing cannot leave the defect quietly open.
   */
  it('allows a cross-tenant write exactly while the re-key evidence is incomplete', async () => {
    const evidence = recordedEvidence();
    const observed = await probeUpdateServerTenantScope();

    expect(
      rekeyReadinessGateFailures({
        predicateIsTenantScoped: !observed.crossTenantPatched,
        evidence,
      }),
    ).toEqual([]);

    // The same statement spelled out, so a red here reads as a sentence rather
    // than an empty-array diff.
    expect(observed.crossTenantPatched).toBe(rekeyReadinessReport(evidence).status === 'BLOCKED');
  });

  it('is described by the source-shape guard the same way it behaves', async () => {
    const observed = await probeUpdateServerTenantScope();

    // `updateServerIsTenantScoped` is the cheap guard the scripts-side gate
    // uses; pinning it against the observed mutation is what stops the two from
    // drifting, in either direction.
    expect(updateServerIsTenantScoped(readFileSync(SERVICE_SOURCE_PATH, 'utf8'))).toBe(
      !observed.crossTenantPatched,
    );
  });

  it('unknown id: resolves undefined (no not-found signal) and mutates nothing', async () => {
    await expect(
      updateServer(updateServerCtxFor('tenant-a'), 'does-not-exist', { name: 'X' }),
    ).resolves.toBeUndefined();
    expect(updateServerRows).toEqual(seedRows());
  });
});

// Slice 1 readiness evidence that needs no credentials.
//
// The remaining Slice 1 blocker is a fact about live data — is every Turso
// `servers.tenant_id` already the canonical Supabase organization id? — and only
// a credential holder can answer it (docs/runbooks/server-tenant-scope-rekey-readiness.md).
// What is answerable here is the blast radius if the answer were "no": which
// shipped read paths already depend on that same equality, and therefore which
// server ids `updateServer` can actually be reached with.
//
// These cases exercise the shipped service against an in-memory `servers` table
// that really applies the `.where()` predicate the service builds (the drizzle
// `eq`/`and` mock at the top of this file turns it into a row predicate). The
// `innerJoin` below is performed by the harness on `userServers.serverId ===
// servers.id`; what is under test is the tenant filter the service adds, not the
// join condition.
let readRows: ServerRow[];

function makeReadDb(links: Array<{ userId: string; serverId: string }> = []) {
  const project = (columns: Record<string, string>, row: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(columns).map(([key, column]) => [key, row[column]]));

  const chain = (source: Array<Record<string, unknown>>, columns: Record<string, string>) => ({
    innerJoin: () =>
      chain(
        source.flatMap((row) =>
          links.filter((link) => link.serverId === row.id).map((link) => ({ ...row, ...link })),
        ),
        columns,
      ),
    where: (predicate: (row: Record<string, unknown>) => boolean) => {
      const matched = source.filter(predicate);
      const projected = () => matched.map((row) => project(columns, row));
      return { orderBy: projected, limit: (n: number) => projected().slice(0, n) };
    },
  });

  return {
    select: (columns: Record<string, string>) => ({
      from: () => chain(readRows as unknown as Array<Record<string, unknown>>, columns),
    }),
    delete: () => ({
      where: (predicate: (row: Record<string, unknown>) => boolean) => {
        readRows = readRows.filter((row) => !predicate(row as unknown as Record<string, unknown>));
        return Promise.resolve(undefined);
      },
    }),
  };
}

const readCtxFor = (tenantId: string, links?: Array<{ userId: string; serverId: string }>) => ({
  db: makeReadDb(links) as never,
  tenantId,
});

describe('server reads already depend on the re-key fact (Slice 1 readiness evidence)', () => {
  beforeEach(() => {
    readRows = seedRows();
  });

  it('listServers hands an admin only their own tenant’s server ids', async () => {
    const rows = await listServers(readCtxFor('tenant-a'), undefined, 'admin');

    expect(rows.map((row) => row.id)).toEqual(['server-a']);
  });

  it('listServers does not let a user_servers link widen tenancy', async () => {
    const links = [
      { userId: 'user-1', serverId: 'server-a' },
      { userId: 'user-1', serverId: 'server-b' },
    ];

    const rows = await listServers(readCtxFor('tenant-a', links), 'user-1', 'user');

    expect(rows.map((row) => row.id)).toEqual(['server-a']);
  });

  it('getServerToken returns null for a server id outside the caller’s tenant', async () => {
    readRows = readRows.map((row) => ({ ...row, token: `${row.id}-token` }));

    await expect(getServerToken(readCtxFor('tenant-a'), 'server-a')).resolves.toBe(
      'server-a-token',
    );
    await expect(getServerToken(readCtxFor('tenant-a'), 'server-b')).resolves.toBeNull();
  });

  it('deleteServer leaves another tenant’s row untouched', async () => {
    await deleteServer(readCtxFor('tenant-a'), 'server-b');

    expect(readRows.map((row) => row.id)).toEqual(['server-a', 'server-b']);
  });
});
