import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';
import { openPulsePostgres } from '$server/test-utils/pulse-postgres';
import {
  seedPulseAuthority,
  PULSE_FIXTURE_ORG as org,
  PULSE_FIXTURE_PROFILE as profile,
} from '$server/test-utils/pulse-fixtures';
const boundary = vi.hoisted(() => ({ pool: vi.fn(), ctx: vi.fn() }));
vi.mock('$server/db/pg-pool', () => ({
  getPgClient: boundary.pool,
  getRlsPgClient: boundary.pool,
  getCriticalPgClient: boundary.pool,
  resetAllPgPools: vi.fn(),
}));
vi.mock('$server/auth/core-ctx', () => ({ requireCoreCtx: boundary.ctx }));
vi.mock('$server/auth/authorize', () => ({
  requireAuth: () => ({ id: 'external-authenticated-profile' }),
}));
vi.mock('$server/services/rbac.service', async (original) => ({
  ...(await original<typeof import('$server/services/rbac.service')>()),
  requireOrgCapability: async () => {},
}));
import { POST, PATCH } from './[id]/+server';
import {
  listRecentPulseDecisions,
  listPending,
  countPending,
} from '$server/services/pulse.service';
import { getPulseReceipt } from '$server/services/pulse-dispatch.store';
let fixture: Awaited<ReturnType<typeof openPulsePostgres>>;
let ws: WebSocketServer;
let writes = 0;
beforeAll(async () => {
  fixture = await openPulsePostgres();
  boundary.pool.mockReturnValue(fixture.pg);
  let connection = 0;
  boundary.ctx.mockImplementation(async () => ({
    db: connection++ % 2 ? fixture.peerDb : fixture.db,
    tenantId: org,
    profileId: profile,
  }));
  ws = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) => ws.once('listening', resolve));
  ws.on('connection', (socket) => {
    socket.send(JSON.stringify({ type: 'event', event: 'connect.challenge' }));
    socket.on('message', (raw) => {
      const frame = JSON.parse(raw.toString());
      if (frame.method === 'cron.add') writes++;
      socket.send(
        JSON.stringify({
          type: 'res',
          id: frame.id,
          ok: true,
          payload:
            frame.method === 'connect'
              ? { type: 'hello-ok', server: { version: 'fixture-v1', commit: 'a'.repeat(40) } }
              : { id: 'remote-fixture' },
        }),
      );
    });
  });
  const address = ws.address();
  if (typeof address === 'string' || !address) throw new Error('Local WS unavailable');
  await seedPulseAuthority(fixture, `ws://127.0.0.1:${address.port}`);
});
afterAll(async () => {
  for (const socket of ws?.clients ?? []) socket.terminate();
  await new Promise<void>((resolve) => ws.close(() => resolve()));
  delete process.env.MINION_PULSE_WORKER_CONFIG;
  await fixture?.close();
});
async function seed(kind = 'create_event') {
  const id = randomUUID();
  await fixture.pg`insert into pulse_proposals(id,org_id,source,kind,title,dedup_key,payload) values(${id},${org},'fixture',${kind},'Reviewed',${id},${JSON.stringify({ args: { title: 'Title', start: '2030-01-01T09:00:00Z', end: '2030-01-01T10:00:00Z' } })}::jsonb)`;
  return id;
}
async function invoke(id: string, body: Record<string, unknown>, method = 'POST') {
  const handler = method === 'POST' ? POST : PATCH;
  return handler({
    locals: {},
    params: { id },
    request: new Request(`http://hub.invalid/api/pulse/proposals/${id}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as Parameters<typeof POST>[0]);
}
describe('actual versioned Pulse route and domain PostgreSQL transaction', () => {
  it('concurrent approvals commit one decision, dispatch and job, with stable duplicate receipt and no route RPC', async () => {
    const id = await seed();
    const [grant] =
      await fixture.pg`select has_table_privilege('app_ledger','bg_jobs','INSERT') as queue_insert`;
    expect(grant.queue_insert).toBe(false);
    const [first, second] = await Promise.all([
      invoke(id, { action: 'approve', expectedRevision: 1 }),
      invoke(id, { action: 'approve', expectedRevision: 1 }),
    ]);
    expect(await first.json()).toEqual(await second.json());
    const [counts] =
      await fixture.pg`select (select count(*)::int from pulse_dispatches where proposal_id=${id}) as dispatches,(select count(*)::int from bg_jobs where type='pulse_dispatch') as jobs`;
    expect(counts).toEqual({ dispatches: 1, jobs: 1 });
    expect(writes).toBe(0);
    const [identity] =
      await fixture.pg`select current_user as role,current_setting('role') as setting`;
    expect(identity.setting).toBe('none');
  });
  it('approve versus edit/dismiss serializes, stale/missing revision creates no dispatch', async () => {
    const stale = await seed();
    const [queueBefore] = await fixture.pg`select count(*)::int as n from bg_jobs`;
    const args = { title: 'Edited', start: '2030-01-01T09:00:00Z', end: '2030-01-01T10:00:00Z' };
    await expect(invoke(stale, { args }, 'PATCH')).rejects.toMatchObject({
      status: 409,
      body: { message: 'refresh_required' },
    });
    for (const expectedRevision of [null, '1', 0])
      await expect(invoke(stale, { args, expectedRevision }, 'PATCH')).rejects.toMatchObject({
        status: 400,
      });
    const [untouched] =
      await fixture.pg`select revision,status,payload from pulse_proposals where id=${stale}`;
    expect(untouched).toMatchObject({
      revision: 1,
      status: 'pending',
      payload: { args: { title: 'Title' } },
    });
    const [notDispatched] =
      await fixture.pg`select count(*)::int as n from pulse_dispatches where proposal_id=${stale}`;
    expect(notDispatched.n).toBe(0);
    const [queueAfter] = await fixture.pg`select count(*)::int as n from bg_jobs`;
    expect(queueAfter).toEqual(queueBefore);
    await invoke(
      stale,
      {
        expectedRevision: 1,
        args: { title: 'Edited', start: '2030-01-01T09:00:00Z', end: '2030-01-01T10:00:00Z' },
      },
      'PATCH',
    );
    await expect(invoke(stale, { action: 'approve', expectedRevision: 1 })).rejects.toMatchObject({
      status: 409,
    });
    await expect(invoke(stale, { action: 'approve' })).rejects.toMatchObject({ status: 409 });
    const id = await seed();
    const outcomes = await Promise.allSettled([
      invoke(id, { action: 'approve', expectedRevision: 1 }),
      invoke(id, { action: 'dismiss', expectedRevision: 1 }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    const [row] =
      await fixture.pg`select count(*)::int as n from pulse_dispatches where proposal_id=${stale}`;
    expect(row.n).toBe(0);
  });
  it('rolls back decision, dispatch and queue together on an actual queue insertion error', async () => {
    const id = await seed();
    await fixture.pg.unsafe(
      "create function pulse_fixture_abort_job() returns trigger language plpgsql as $$ begin raise exception 'fixture queue failure'; end $$; create trigger pulse_fixture_abort_job before insert on bg_jobs for each row execute function pulse_fixture_abort_job()",
    );
    try {
      await expect(invoke(id, { action: 'approve', expectedRevision: 1 })).rejects.toThrow();
    } finally {
      await fixture.pg.unsafe(
        'drop trigger pulse_fixture_abort_job on bg_jobs; drop function pulse_fixture_abort_job()',
      );
    }
    const [row] =
      await fixture.pg`select status,owner_profile_id,decided_at from pulse_proposals where id=${id}`;
    expect(row).toEqual({ status: 'pending', owner_profile_id: null, decided_at: null });
    const [count] =
      await fixture.pg`select count(*)::int as n from pulse_dispatches where proposal_id=${id}`;
    expect(count.n).toBe(0);
  });
  it('concurrent approve and edit decide only the content revision that won the lock', async () => {
    const id = await seed();
    const result = await Promise.allSettled([
      invoke(id, { action: 'approve', expectedRevision: 1 }),
      invoke(
        id,
        {
          expectedRevision: 1,
          args: {
            title: 'Concurrent edit',
            start: '2030-01-01T09:00:00Z',
            end: '2030-01-01T10:00:00Z',
          },
        },
        'PATCH',
      ),
    ]);
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    const [row] = await fixture.pg`select status,revision from pulse_proposals where id=${id}`;
    expect(
      row.status === 'pending'
        ? row.revision === 2
        : row.status === 'approved' && row.revision === 1,
    ).toBe(true);
    const [count] =
      await fixture.pg`select count(*)::int as n from pulse_dispatches where proposal_id=${id}`;
    expect(count.n).toBe(row.status === 'approved' ? 1 : 0);
  });
  it('same-org other owner and wrong org cannot read or mutate bound proposals', async () => {
    const id = await seed('fyi');
    await fixture.pg`update pulse_proposals set owner_profile_id='another-profile' where id=${id}`;
    await expect(invoke(id, { action: 'dismiss', expectedRevision: 1 })).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      getPulseReceipt({ db: fixture.peerDb, tenantId: org, profileId: profile }, id),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('projects bounded keyset receipts and keeps legacy executedAt explicitly unverified', async () => {
    const ctx = { db: fixture.db, tenantId: org, profileId: profile };
    const id = await seed('fyi');
    await invoke(id, { action: 'dismiss', expectedRevision: 1 });
    const legacy = await seed('fyi');
    await fixture.pg`update pulse_proposals set status='approved',executed_at=now() where id=${legacy}`;
    expect((await getPulseReceipt(ctx, legacy)).dispatch?.state).toBe('legacy_unverified');
    const page = await listRecentPulseDecisions(ctx, { limit: 1 });
    expect(page).toHaveLength(1);
    const next = await listRecentPulseDecisions(ctx, {
      limit: 1,
      cursor: { decidedAt: page[0].decidedAt, id: page[0].proposalId },
    });
    expect(next.every((row) => row.proposalId !== page[0].proposalId)).toBe(true);
    expect(page[0]).not.toHaveProperty('payload');
    expect(page[0]).not.toHaveProperty('error');
    expect(await countPending(ctx)).toBe((await listPending(ctx)).length);
    await expect(listRecentPulseDecisions(ctx, { limit: 51 })).rejects.toThrow();
    await expect(
      getPulseReceipt({ ...ctx, tenantId: '10000000-0000-4000-8000-000000000099' }, id),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('informational kinds cannot dispatch by smuggling a tool and preserve legacy atomic decisions', async () => {
    for (const kind of ['fyi', 'digest', 'draft_reply', 'unknown']) {
      const id = await seed(kind);
      await fixture.pg`update pulse_proposals set payload='{"tool":"cron.add","args":{"agentId":"admin"}}' where id=${id}`;
      const response = await invoke(id, { action: 'approve' });
      expect((await response.json()).decision).toBe('approved');
      const [row] =
        await fixture.pg`select count(*)::int as n from pulse_dispatches where proposal_id=${id}`;
      expect(row.n).toBe(0);
    }
  });
});
