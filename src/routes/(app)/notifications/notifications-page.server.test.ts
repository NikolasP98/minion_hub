import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openPulsePostgres } from '$server/test-utils/pulse-postgres';
const boundary = vi.hoisted(() => ({
  ctx: vi.fn(),
  canReview: true,
  canPulse: true,
  inbox: vi.fn(),
  join: vi.fn(),
}));
vi.mock('$server/auth/authorize', () => ({ requireAuth: () => ({ id: 'authenticated' }) }));
vi.mock('$server/auth/core-ctx', () => ({ requireCoreCtx: boundary.ctx }));
vi.mock('$server/services/rbac.service', () => ({
  hasOrgCapability: async (_locals: unknown, module: string) =>
    module === 'users' ? boundary.canReview : boundary.canPulse,
}));
vi.mock('$server/services/join/requests.service', () => ({ listPendingRequests: boundary.join }));
vi.mock('$server/services/inbox/inbox.service', () => ({ listFeed: boundary.inbox }));
import { load } from './+page.server';
let fixture: Awaited<ReturnType<typeof openPulsePostgres>>;
const org = '10000000-0000-4000-8000-000000000001';
const profile = '20000000-0000-4000-8000-000000000001';
beforeAll(async () => {
  fixture = await openPulsePostgres();
  boundary.ctx.mockResolvedValue({ db: fixture.db, tenantId: org, profileId: profile });
  boundary.inbox.mockResolvedValue({ items: [{ id: 'preserved-inbox' }] });
  boundary.join.mockResolvedValue([
    {
      id: 'preserved-join',
      email: 'fixture@example.invalid',
      message: null,
      created_at: '2026-01-01T00:00:00Z',
      organization_id: org,
    },
  ]);
  for (const owner of [null, profile, 'other-owner']) {
    const id = randomUUID();
    await fixture.pg`insert into pulse_proposals(id,org_id,source,kind,title,dedup_key,owner_profile_id,revision,error,payload) values(${id},${org},'fixture','fyi',${owner ?? 'legacy'},${id},${owner},2,'PRIVATE PROVIDER ERROR','{}')`;
  }
});
afterAll(async () => {
  await fixture?.close();
});
async function invoke(kind = 'personal') {
  return (await load({
    locals: { tenantCtx: { tenantId: org } },
    parent: async () => ({ activeOrgKind: kind }),
    depends: () => {},
  } as Parameters<typeof load>[0])) as {
    pulseProposals: Record<string, unknown>[];
    inboxItems: unknown[];
    requests: unknown[];
  };
}
describe('actual notifications SSR with owner-scoped Pulse reader', () => {
  it('excludes same-org other-owner, includes unbound legacy, projects only reviewed fields and revision', async () => {
    boundary.canReview = true;
    boundary.canPulse = true;
    const data = await invoke();
    expect(data.pulseProposals.map((row) => row.title).sort()).toEqual(['legacy', profile].sort());
    for (const row of data.pulseProposals) {
      expect(row.revision).toBe(2);
      expect(row).not.toHaveProperty('error');
      expect(row).not.toHaveProperty('internalInputHash');
      expect(row).not.toHaveProperty('decidedBy');
    }
    expect(data.inboxItems).toEqual([{ id: 'preserved-inbox' }]);
    expect(data.requests).toHaveLength(1);
  });
  it('retains review, Pulse read and organization-kind gates without changing inbox/join requests', async () => {
    boundary.canReview = false;
    expect((await invoke()).pulseProposals).toEqual([]);
    expect((await invoke()).requests).toEqual([]);
    expect((await invoke()).inboxItems).toHaveLength(1);
    boundary.canReview = true;
    boundary.canPulse = false;
    expect((await invoke()).pulseProposals).toEqual([]);
    expect((await invoke()).requests).toHaveLength(1);
    boundary.canPulse = true;
    expect((await invoke('business')).pulseProposals).toEqual([]);
    expect((await invoke('business')).requests).toHaveLength(1);
  });
});
