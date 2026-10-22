import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ activate: vi.fn(), limit: vi.fn() }));
vi.mock('$server/services/personal-agent-provisioner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$server/services/personal-agent-provisioner')>()),
  activatePersonalAgent: mocks.activate,
}));
vi.mock('$server/auth/rate-limit', () => ({ checkRateLimit: mocks.limit }));

const db = new PGlite();
const pg = drizzle(db);
// PGlite returns { rows }; production postgres-js returns the row array.
vi.mock('$server/db/pg-client', () => ({
  getCoreDb: () => ({
    execute: async (statement: Parameters<typeof pg.execute>[0]) =>
      (await pg.execute(statement)).rows,
  }),
}));
import { POST } from './+server';

const org = '10000000-0000-4000-8000-000000000001';
const otherOrg = '10000000-0000-4000-8000-000000000002';
const profile = '20000000-0000-4000-8000-000000000001';
const gw = '30000000-0000-4000-8000-000000000001';
const otherGw = '30000000-0000-4000-8000-000000000002';
const account = '+51992376833';
const phone = '+51999888777';
const agentId = `personal-${profile}`;

function call(
  body: unknown = { accountId: account, phone },
  locals: Record<string, unknown> = { serverId: 'srv-1', tenantCtx: { tenantId: org } },
) {
  const request = new Request('http://localhost/api/gateway/whatsapp/member', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return POST({ locals, request } as never) as Promise<Response>;
}
const result = async (body?: unknown) => (await call(body)).json();

beforeAll(async () => {
  await db.exec(`
    create table gateway (id uuid primary key, legacy_server_id text, org_id uuid);
    create table channels (type text, gateway_id uuid, account_id text, tenant_id uuid, settings jsonb, replies text);
    create table user_identities (user_id uuid, provider text, external_id text, verified_at bigint);
    create table organization_members (organization_id uuid, profile_id uuid);
    create table personal_agents (profile_id uuid, agent_id text, gateway_id uuid, provisioning_status text, retry_count int default 0, last_retry_at timestamptz);
  `);
});
afterAll(() => db.close());
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.limit.mockReturnValue(true);
  mocks.activate.mockResolvedValue(agentId);
  await db.exec(`truncate gateway, channels, user_identities, organization_members, personal_agents;
    insert into gateway values ('${gw}','srv-1','${org}');
    insert into channels values ('whatsapp','${gw}','${account}','${org}','{"memberAgents":true}','bound');
    insert into user_identities values ('${profile}','whatsapp','51999888777',1);
    insert into organization_members values ('${org}','${profile}');
    insert into personal_agents (profile_id, agent_id, gateway_id, provisioning_status) values ('${profile}','${agentId}','${gw}','active');
  `);
});

describe('POST /api/gateway/whatsapp/member', () => {
  it('a verified member with an agent bound to this gateway is a member', async () => {
    expect(await result()).toEqual({ member: true, profileId: profile, agentId });
    expect(mocks.activate).not.toHaveBeenCalled();
    expect(mocks.limit).toHaveBeenCalledWith('wa-member:srv-1', 600, 60_000);
    expect(mocks.limit).toHaveBeenCalledWith('wa-member:srv-1:51999888777', 30, 60_000);
  });

  it('401 without a server token, or with an ambiguous or foreign gateway', async () => {
    await expect(call(undefined, { tenantCtx: { tenantId: org } })).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      call(undefined, { serverId: 'srv-1', tenantCtx: { tenantId: otherOrg } }),
    ).rejects.toMatchObject({ status: 401 });
    await db.exec(`insert into gateway values ('${otherGw}','srv-1','${org}')`);
    await expect(call()).rejects.toMatchObject({ status: 401 });
  });

  it('429 when rate-limited, before any lookup', async () => {
    mocks.limit.mockReturnValue(false);
    await expect(call()).rejects.toMatchObject({ status: 429 });
  });

  it.each([
    ['an unknown account', `update channels set account_id='+51000000000'`],
    ['an account row on another gateway', `update channels set gateway_id='${otherGw}'`],
    ['an account row in another org', `update channels set tenant_id='${otherOrg}'`],
    ['a non-whatsapp row', `update channels set type='telegram'`],
    ['member mode off', `update channels set settings='{}'`],
    ['member mode explicitly false', `update channels set settings='{"memberAgents":false}'`],
    ['a receive-only account', `update channels set replies='none'`],
  ])('account_not_found for %s', async (_label, mutation) => {
    await db.exec(mutation);
    expect(await result()).toEqual({ member: false, reason: 'account_not_found' });
  });

  it.each([
    ['an unverified identity', 'update user_identities set verified_at=null'],
    ['no identity', 'delete from user_identities'],
    ['another provider', `update user_identities set provider='telegram'`],
  ])('not_member (never not_verified) for %s', async (_label, mutation) => {
    await db.exec(mutation);
    expect(await result()).toEqual({ member: false, reason: 'not_member' });
  });

  it('account_not_found before any activation when member mode is off', async () => {
    await db.exec(`update channels set settings='{}'; update personal_agents set gateway_id=null`);
    expect(await result()).toEqual({ member: false, reason: 'account_not_found' });
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it('agent_not_ready for an unbound agent of a multi-org member, without activating', async () => {
    await db.exec(`update personal_agents set gateway_id=null;
      insert into organization_members values ('${otherOrg}','${profile}')`);
    expect(await result()).toEqual({ member: false, reason: 'agent_not_ready' });
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it('a multi-org member whose agent is already bound here is still a member', async () => {
    await db.exec(`insert into organization_members values ('${otherOrg}','${profile}')`);
    expect(await result()).toEqual({ member: true, profileId: profile, agentId });
  });

  it('not_member when the identity owner is not in the org', async () => {
    await db.exec(`update organization_members set organization_id='${otherOrg}'`);
    expect(await result()).toEqual({ member: false, reason: 'not_member' });
  });

  it('no_agent without a personal agent row', async () => {
    await db.exec('delete from personal_agents');
    expect(await result()).toEqual({ member: false, reason: 'no_agent' });
  });

  it('agent_not_ready when the agent is bound to a different gateway', async () => {
    await db.exec(`update personal_agents set gateway_id='${otherGw}'`);
    expect(await result()).toEqual({ member: false, reason: 'agent_not_ready' });
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it('activates an unbound agent in a single-gateway org with a server-side ctx', async () => {
    await db.exec('update personal_agents set gateway_id=null');
    expect(await result()).toEqual({ member: true, profileId: profile, agentId });
    expect(mocks.activate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ tenantId: org, profileId: profile }),
      profile,
    );
  });

  it('agent_not_ready without activating while the web retry budget is spent or backing off', async () => {
    await db.exec(`update personal_agents set gateway_id=null, retry_count=5`);
    expect(await result()).toEqual({ member: false, reason: 'agent_not_ready' });
    await db.exec(`update personal_agents set retry_count=1, last_retry_at=now()`);
    expect(await result()).toEqual({ member: false, reason: 'agent_not_ready' });
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it('agent_not_ready when single-gateway activation fails', async () => {
    await db.exec('update personal_agents set gateway_id=null');
    mocks.activate.mockRejectedValue(new Error('roster miss'));
    expect(await result()).toEqual({ member: false, reason: 'agent_not_ready' });
  });

  it('agent_not_ready for an unbound agent in a multi-gateway org, without activating', async () => {
    await db.exec(`update personal_agents set gateway_id=null;
      insert into gateway values ('${otherGw}','srv-2','${org}')`);
    expect(await result()).toEqual({ member: false, reason: 'agent_not_ready' });
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it('400 for a missing phone or account', async () => {
    await expect(call({ accountId: account })).rejects.toMatchObject({ status: 400 });
    await expect(call({ phone })).rejects.toMatchObject({ status: 400 });
  });

  it('never logs the raw phone number', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await db.exec('update personal_agents set gateway_id=null');
    await result();
    const logged = info.mock.calls.flat().join(' ');
    expect(logged).toContain('decision=activated');
    expect(logged).not.toContain('51999888777');
    info.mockRestore();
  });
});
