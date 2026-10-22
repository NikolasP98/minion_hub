import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreCtx } from '$server/auth/core-ctx';

const mocks = vi.hoisted(() => ({ target: vi.fn(), rpc: vi.fn() }));
vi.mock('./gateway-lease.service', () => ({ resolveOrgChannelTarget: mocks.target }));
vi.mock('$lib/server/gateway-rpc', () => ({ gatewayCallToInstance: mocks.rpc }));
vi.mock('$server/gateway-channel', () => ({ currentBuildChannel: () => 'prd' }));
import { activatePersonalAgent } from './personal-agent-provisioner';
import {
  preparePersonalAgentBinding,
  commitPersonalAgentBinding,
  recordPersonalAgentBindingFailure,
  recordPersonalAgentClientFailure,
} from './personal-agent-binding';

const db = new PGlite();
const org = '10000000-0000-4000-8000-000000000001';
const profile = '20000000-0000-4000-8000-000000000001';
const gateway = '30000000-0000-4000-8000-000000000001';
const other = '30000000-0000-4000-8000-000000000002';
const agentId = 'personal-legacy-owner';
const target = {
  gatewayId: gateway,
  serverId: gateway,
  url: 'ws://127.0.0.1:18789',
  token: 'fixture-token',
  channel: 'prd',
  name: 'QA',
};
const pg = drizzle(db);
// PGlite exposes { rows }; production postgres-js exposes the row array. SQL and
// transaction behavior remain real; only the driver's result envelope is adapted.
const adapt = (tx: Pick<typeof pg, 'execute'>) => ({
  execute: async (statement: Parameters<typeof pg.execute>[0]) =>
    (await tx.execute(statement)).rows,
});
const ctx = {
  db: {
    ...adapt(pg),
    transaction: (work: (tx: ReturnType<typeof adapt>) => Promise<unknown>) =>
      pg.transaction((tx) => work(adapt(tx))),
  },
  tenantId: org,
  profileId: profile,
} as unknown as CoreCtx;
const read = async () =>
  (await db.query<{ gateway_id: string | null }>('select * from personal_agents')).rows[0];

beforeAll(async () => {
  await db.exec(`
    create table organization_members (profile_id uuid, organization_id uuid);
    create table profiles (id uuid primary key, personal_agent_id text);
    create table gateway (id uuid primary key, org_id uuid, channel text, url text, token_ciphertext text, token_iv text, auth_mode text);
    create table gateway_lease (org_id uuid, channel text, gateway_id uuid);
    create table personal_agents (id text primary key, profile_id uuid unique, agent_id text, gateway_id uuid, provisioning_status text, provisioning_error text, updated_at timestamptz, last_retry_at timestamptz, retry_count integer);
  `);
});
afterAll(() => db.close());
beforeEach(async () => {
  vi.clearAllMocks();
  await db.exec(`truncate organization_members, profiles, gateway, gateway_lease, personal_agents;
    insert into organization_members values ('${profile}','${org}');
    insert into profiles values ('${profile}','${agentId}');
    insert into gateway values ('${gateway}','${org}','prd','${target.url}','fixture-token','','token');
    insert into gateway_lease values ('${org}','prd','${gateway}');
    insert into personal_agents values ('pa','${profile}','${agentId}',null,'active',null,'2026-10-18T01:00:00.123456Z',null,0);
  `);
  mocks.target.mockResolvedValue(target);
  mocks.rpc.mockImplementation(async (_url, _token, method) =>
    method === 'agents.list' ? { agents: [{ id: agentId }] } : {},
  );
});

describe('verified personal-agent binding with real PostgreSQL transactions', () => {
  it('repairs an active NULL binding after exact roster proof and preserves the legacy identity', async () => {
    await expect(activatePersonalAgent(ctx, profile)).resolves.toBe(agentId);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(target.url, target.token, 'agents.list', {});
    expect(await read()).toMatchObject({
      gateway_id: gateway,
      agent_id: agentId,
      provisioning_status: 'active',
    });
    expect((await db.query('select personal_agent_id from profiles')).rows[0]).toEqual({
      personal_agent_id: agentId,
    });
    await activatePersonalAgent(ctx, profile);
    expect(await read()).toMatchObject({ gateway_id: gateway, agent_id: agentId });
  });
  it.each([
    { agents: [], calls: ['agents.list', 'agents.create', 'agents.list'] },
    { agents: [{ id: agentId }, { id: agentId }], calls: ['agents.list'] },
    { agents: [{ id: 'personal-other' }], calls: ['agents.list', 'agents.create', 'agents.list'] },
  ])('rejects a missing, duplicate or wrong runtime identity: %j', async ({ agents, calls }) => {
    mocks.rpc.mockResolvedValue({ agents });
    await expect(activatePersonalAgent(ctx, profile)).rejects.toThrow('not found');
    expect(await read()).toMatchObject({
      gateway_id: null,
      provisioning_status: 'active',
      retry_count: 1,
    });
    expect(mocks.rpc.mock.calls.map((call) => call[2])).toEqual(calls);
  });
  it('creates an active-but-unbound agent that is missing from the roster, re-verifies and binds', async () => {
    let created = false;
    mocks.rpc.mockImplementation(async (_url, _token, method) => {
      if (method === 'agents.create') created = true;
      return method === 'agents.list' ? { agents: created ? [{ id: agentId }] : [] } : {};
    });
    await expect(activatePersonalAgent(ctx, profile)).resolves.toBe(agentId);
    expect(mocks.rpc.mock.calls.map((call) => call[2])).toEqual([
      'agents.list',
      'agents.create',
      'agents.list',
    ]);
    expect(mocks.rpc.mock.calls[1][3]).toEqual({
      name: agentId,
      workspace: `~/.minion/agents/${agentId}/workspace`,
    });
    expect(await read()).toMatchObject({ gateway_id: gateway, provisioning_status: 'active' });
  });
  it('never creates for an active bound agent, even if the roster misses it', async () => {
    await db.exec(`update personal_agents set gateway_id='${gateway}'`);
    mocks.rpc.mockResolvedValue({ agents: [] });
    await expect(activatePersonalAgent(ctx, profile)).rejects.toThrow('not found');
    expect(mocks.rpc.mock.calls.map((call) => call[2])).toEqual(['agents.list']);
  });
  it('verify-only never creates an active unbound agent', async () => {
    mocks.rpc.mockResolvedValue({ agents: [] });
    await expect(activatePersonalAgent(ctx, profile, { verifyOnly: true })).rejects.toThrow(
      'not found',
    );
    expect(mocks.rpc.mock.calls.map((call) => call[2])).toEqual(['agents.list']);
  });
  it('creates a pending identity on the selected target, verifies it and then activates', async () => {
    await db.exec("update personal_agents set provisioning_status='pending'");
    mocks.rpc.mockImplementation(async (_url, _token, method) => {
      expect((await read()).gateway_id).toBeNull();
      return method === 'agents.list' ? { agents: [{ id: agentId }] } : {};
    });
    await activatePersonalAgent(ctx, profile);
    expect(mocks.rpc.mock.calls.map((call) => call[2])).toEqual(['agents.create', 'agents.list']);
    expect(
      mocks.rpc.mock.calls.every((call) => call[0] === target.url && call[1] === target.token),
    ).toBe(true);
    expect(await read()).toMatchObject({ gateway_id: gateway, provisioning_status: 'active' });
  });
  it('never treats an already-exists error as proof and does not activate a failed create', async () => {
    await db.exec("update personal_agents set provisioning_status='pending'");
    mocks.rpc.mockRejectedValue(new Error('agent already exists'));
    await expect(activatePersonalAgent(ctx, profile)).rejects.toThrow('verification failed');
    expect(mocks.rpc.mock.calls.map((call) => call[2])).toEqual(['agents.create', 'agents.list']);
    expect(await read()).toMatchObject({ gateway_id: null, provisioning_status: 'error' });
  });
  it('legacy client success verifies without creating an agent', async () => {
    await db.exec("update personal_agents set provisioning_status='pending'");
    await activatePersonalAgent(ctx, profile, { verifyOnly: true });
    expect(mocks.rpc.mock.calls.map((call) => call[2])).toEqual(['agents.list']);
  });
  it('rejects a different existing binding and a forged profile before any gateway call', async () => {
    await db.exec(`update personal_agents set gateway_id='${other}'`);
    await expect(activatePersonalAgent(ctx, profile)).rejects.toThrow('assignment');
    await expect(activatePersonalAgent(ctx, 'another-user')).rejects.toThrow('assignment');
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect((await read()).gateway_id).toBe(other);
  });
  it.each([
    'delete from organization_members',
    `update gateway set org_id='${other}'`,
    "update gateway set channel='dev'",
    "update gateway set token_ciphertext='rotated'",
    "update gateway set url='ws://127.0.0.1:19999'",
    `update gateway_lease set gateway_id='${other}'`,
    `update personal_agents set gateway_id='${other}'`,
    "update personal_agents set agent_id='changed'",
    "update personal_agents set provisioning_status='error'",
    "update personal_agents set updated_at='2026-10-18T01:00:00.123457Z'",
  ])('fences a changed authority or assignment before commit: %s', async (mutation) => {
    const binding = await preparePersonalAgentBinding(ctx, profile);
    await db.exec(mutation);
    await expect(commitPersonalAgentBinding(ctx, binding)).rejects.toThrow('assignment');
    expect((await read()).gateway_id).not.toBe(gateway);
  });
  it('allows concurrent identical completion but never overwrites the winner with a failed attempt', async () => {
    const a = await preparePersonalAgentBinding(ctx, profile);
    const b = await preparePersonalAgentBinding(ctx, profile);
    await commitPersonalAgentBinding(ctx, a);
    const winner = await read();
    await commitPersonalAgentBinding(ctx, b);
    await recordPersonalAgentBindingFailure(ctx, b);
    await recordPersonalAgentClientFailure(ctx, profile);
    expect(await read()).toEqual(winner);
  });
  it('leaves a pending identity unbound if explicit-create configuration fails', async () => {
    await db.exec("update personal_agents set provisioning_status='pending'");
    mocks.rpc.mockImplementation(async (_url, _token, method) => {
      if (method === 'config.patch') throw new Error('fixture failed');
      return method === 'agents.list' ? { agents: [{ id: agentId }] } : {};
    });
    await expect(activatePersonalAgent(ctx, profile, { identity: { name: 'QA' } })).rejects.toThrow(
      'verification failed',
    );
    expect(await read()).toMatchObject({ gateway_id: null, provisioning_status: 'error' });
  });

  it.each([
    'delete from organization_members',
    `update gateway_lease set gateway_id='${other}'`,
    "update gateway set token_ciphertext='rotated'",
    `update personal_agents set gateway_id='${other}'`,
  ])('rechecks authority after the roster RPC completes: %s', async (mutation) => {
    mocks.rpc.mockImplementation(async () => {
      await db.exec(mutation);
      return { agents: [{ id: agentId }] };
    });
    await expect(activatePersonalAgent(ctx, profile)).rejects.toThrow('assignment');
    expect((await read()).gateway_id).not.toBe(gateway);
  });

  it('keeps config operations on the verified target before the binding commit', async () => {
    await activatePersonalAgent(ctx, profile, {
      identity: { name: 'My agent', personality: 'helpful' },
    });
    expect(mocks.rpc.mock.calls.map((call) => call[2])).toEqual([
      'agents.list',
      'config.get',
      'config.patch',
    ]);
    expect(
      mocks.rpc.mock.calls.every((call) => call[0] === target.url && call[1] === target.token),
    ).toBe(true);
  });
});
