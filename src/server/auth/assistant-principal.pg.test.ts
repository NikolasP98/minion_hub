import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { createClient } from '@supabase/supabase-js';

const entrypoints = vi.hoisted(() => ({ db: vi.fn(), admin: vi.fn() }));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: entrypoints.db }));
vi.mock('$server/supabase', () => ({ supabaseAdmin: entrypoints.admin }));

import { resolveAssistantPrincipal } from './assistant-principal';

const ORG_A = '10000000-0000-4000-8000-000000000001';
const ORG_B = '10000000-0000-4000-8000-000000000002';
const PROFILE_A = '20000000-0000-4000-8000-000000000001';
const PROFILE_B = '20000000-0000-4000-8000-000000000002';
const GATEWAY_A = '30000000-0000-4000-8000-000000000001';
const GATEWAY_B = '30000000-0000-4000-8000-000000000002';
const AGENT_A = 'Personal-Legacy_User';
const AGENT_B = 'personal-other';
const BRAIN = 'brain-40000000-0000-4000-8000-000000000001';
const client = new PGlite();

// Real Supabase query builders use this HTTP boundary instead of a network.
// Only the SELECT/filter subset used by membership and RBAC is implemented;
// every returned row comes from the same PostgreSQL fixture as the Drizzle joins.
const columns: Record<string, Set<string>> = {
  organization_members: new Set(['organization_id', 'profile_id', 'role']),
  member_roles: new Set(['org_id', 'profile_id', 'role_key']),
  permission_rules: new Set([
    'org_id',
    'role_key',
    'module',
    'can_view',
    'can_create',
    'can_edit',
    'can_delete',
    'can_export',
    'can_manage',
    'if_owner',
    'field_level',
  ]),
};
const requests: string[] = [];
const fixtureFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin !== 'http://supabase.test' || request.method !== 'GET') {
    throw new Error('Unexpected fixture transport request');
  }
  const table = url.pathname.replace('/rest/v1/', '');
  const allowed = columns[table];
  if (!allowed) throw new Error(`Unexpected fixture table: ${table}`);
  const select = (url.searchParams.get('select') ?? '').split(',');
  if (select.some((column) => !allowed.has(column))) {
    throw new Error('Unexpected fixture projection');
  }
  const params: string[] = [];
  const where: string[] = [];
  for (const [column, value] of url.searchParams) {
    if (column === 'select') continue;
    if (!allowed.has(column)) throw new Error('Unexpected fixture filter');
    if (value.startsWith('eq.')) {
      params.push(value.slice(3));
      where.push(`"${column}" = $${params.length}`);
    } else if (value.startsWith('in.(') && value.endsWith(')')) {
      const placeholders = value
        .slice(4, -1)
        .split(',')
        .map((item) => {
          params.push(item);
          return `$${params.length}`;
        });
      where.push(`"${column}" IN (${placeholders.join(',')})`);
    } else {
      throw new Error('Unexpected fixture filter operator');
    }
  }
  requests.push(table);
  const result = await client.query(
    `SELECT ${select.map((column) => `"${column}"`).join(',')} FROM "${table}"${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`,
    params,
  );
  return new Response(JSON.stringify(result.rows), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

function requestUrl(params: Record<string, string | undefined>) {
  const url = new URL('https://hub.test/api/gateway/query/finance');
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url;
}

function gatewayLocals(serverId = GATEWAY_A, tenantId = ORG_A): App.Locals {
  return { serverId, tenantCtx: { db: {} as never, tenantId } };
}

function browserLocals(profileId = PROFILE_A, role: 'user' | 'admin' = 'user'): App.Locals {
  return {
    user: {
      id: profileId,
      supabaseId: profileId,
      email: 'synthetic@example.test',
      displayName: null,
      role,
    },
    orgId: ORG_A,
    tenantCtx: { db: {} as never, tenantId: ORG_A },
  };
}

beforeAll(async () => {
  await client.exec(`
    CREATE TABLE gateway (id uuid PRIMARY KEY, legacy_server_id text, org_id uuid);
    CREATE TABLE personal_agents (
      profile_id uuid NOT NULL UNIQUE, agent_id text NOT NULL,
      gateway_id uuid REFERENCES gateway(id), provisioning_status text NOT NULL
    );
    CREATE TABLE brains (agent_id text, org_id uuid NOT NULL);
    CREATE TABLE organization_members (
      organization_id uuid NOT NULL, profile_id uuid NOT NULL, role text,
      PRIMARY KEY (organization_id, profile_id)
    );
    CREATE TABLE member_roles (org_id uuid, profile_id uuid, role_key text);
    CREATE TABLE permission_rules (
      org_id uuid, role_key text, module text, can_view boolean, can_create boolean,
      can_edit boolean, can_delete boolean, can_export boolean, can_manage boolean,
      if_owner boolean, field_level integer
    );
  `);
  entrypoints.db.mockReturnValue(drizzle(client));
  entrypoints.admin.mockReturnValue(
    createClient('http://supabase.test', 'synthetic-test-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fixtureFetch },
    }),
  );
}, 15_000);

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  requests.length = 0;
  await client.exec(
    'TRUNCATE personal_agents, gateway, brains, organization_members, member_roles, permission_rules',
  );
  await client.query('INSERT INTO gateway VALUES ($1, $2, $3), ($4, $5, $6)', [
    GATEWAY_A,
    'legacy-a',
    ORG_A,
    GATEWAY_B,
    'legacy-b',
    ORG_B,
  ]);
  await client.query('INSERT INTO personal_agents VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)', [
    PROFILE_A,
    AGENT_A,
    GATEWAY_A,
    'active',
    PROFILE_B,
    AGENT_B,
    GATEWAY_B,
    'active',
  ]);
  await client.query('INSERT INTO organization_members VALUES ($1, $2, $3), ($4, $5, $6)', [
    ORG_A,
    PROFILE_A,
    'owner',
    ORG_B,
    PROFILE_B,
    'viewer',
  ]);
  await client.query('INSERT INTO brains VALUES ($1, $2)', [BRAIN, ORG_A]);
});

describe('assistant principal with real PostgreSQL queries', () => {
  it.each([GATEWAY_A, 'legacy-a'])(
    'resolves assigned actor through canonical/legacy gateway %s',
    async (serverId) => {
      const principal = await resolveAssistantPrincipal(
        gatewayLocals(serverId),
        requestUrl({ agentId: AGENT_A.toLowerCase() }),
      );
      expect(principal).toMatchObject({ principalId: PROFILE_A, orgId: ORG_A, role: 'owner' });
      expect(principal.capabilities.can('finance', 'view')).toBe(true);
      expect(requests).toContain('permission_rules');
    },
  );

  it('uses persisted role overrides through the real capability resolver', async () => {
    await client.query('INSERT INTO member_roles VALUES ($1, $2, $3)', [
      ORG_A,
      PROFILE_A,
      'viewer',
    ]);
    await client.query(
      'INSERT INTO permission_rules (org_id, role_key, module, can_view) VALUES ($1, $2, $3, $4)',
      [ORG_A, 'viewer', 'finance', false],
    );
    const principal = await resolveAssistantPrincipal(
      gatewayLocals(),
      requestUrl({ agentId: AGENT_A }),
    );
    expect(principal.capabilities.roles).toEqual(['viewer']);
    expect(principal.capabilities.can('finance', 'view')).toBe(false);
  });

  it.each([
    ['actor from another gateway', AGENT_B],
    ['wildcard actor', 'Personal-%'],
    ['missing actor', 'missing'],
  ])('rejects %s through the actual assignment join', async (_label, agentId) => {
    await expect(
      resolveAssistantPrincipal(gatewayLocals(), requestUrl({ agentId })),
    ).rejects.toMatchObject({
      status: 403,
      body: { code: 'ASSISTANT_GATEWAY_ASSIGNMENT_REQUIRED' },
    });
    expect(requests).toEqual([]);
  });

  it.each(['pending', 'failed'])('rejects %s provisioning', async (status) => {
    await client.query(
      'UPDATE personal_agents SET provisioning_status = $1 WHERE profile_id = $2',
      [status, PROFILE_A],
    );
    await expect(
      resolveAssistantPrincipal(gatewayLocals(), requestUrl({ agentId: AGENT_A })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects ambiguous case-insensitive actors even though profile ownership is unique', async () => {
    await client.query(
      'UPDATE personal_agents SET gateway_id = $1, agent_id = $2 WHERE profile_id = $3',
      [GATEWAY_A, AGENT_A.toLowerCase(), PROFILE_B],
    );
    await expect(
      resolveAssistantPrincipal(gatewayLocals(), requestUrl({ agentId: AGENT_A })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it.each(['legacy-a', GATEWAY_A])(
    'rejects ambiguous alias %s before the selected actor could disambiguate it',
    async (alias) => {
      await client.query('UPDATE gateway SET legacy_server_id = $1 WHERE id = $2', [
        alias,
        GATEWAY_B,
      ]);
      await expect(
        resolveAssistantPrincipal(gatewayLocals(alias), requestUrl({ agentId: AGENT_A })),
      ).rejects.toMatchObject({
        status: 403,
        body: { code: 'ASSISTANT_GATEWAY_ASSIGNMENT_REQUIRED' },
      });
      expect(requests).toEqual([]);
    },
  );

  it('rejects a token org that no longer matches the gateway row', async () => {
    await client.query('UPDATE gateway SET org_id = $1 WHERE id = $2', [ORG_B, GATEWAY_A]);
    await expect(
      resolveAssistantPrincipal(gatewayLocals(), requestUrl({ agentId: AGENT_A })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects a requested second org even when the actor has membership there', async () => {
    await client.query('INSERT INTO organization_members VALUES ($1, $2, $3)', [
      ORG_B,
      PROFILE_A,
      'owner',
    ]);
    await expect(
      resolveAssistantPrincipal(gatewayLocals(), requestUrl({ agentId: AGENT_A, orgId: ORG_B })),
    ).rejects.toMatchObject({ status: 403, body: { code: 'ASSISTANT_ORG_NOT_ASSIGNED' } });
  });

  it('observes membership removal on the next request', async () => {
    await resolveAssistantPrincipal(gatewayLocals(), requestUrl({ agentId: AGENT_A }));
    await client.query('DELETE FROM organization_members WHERE profile_id = $1', [PROFILE_A]);
    await expect(
      resolveAssistantPrincipal(gatewayLocals(), requestUrl({ agentId: AGENT_A })),
    ).rejects.toMatchObject({ status: 403, body: { code: 'ASSISTANT_ORG_NOT_ASSIGNED' } });
  });

  it('observes assignment removal on the next request', async () => {
    await resolveAssistantPrincipal(gatewayLocals(), requestUrl({ agentId: AGENT_A }));
    await client.query('UPDATE personal_agents SET gateway_id = NULL WHERE profile_id = $1', [
      PROFILE_A,
    ]);
    await expect(
      resolveAssistantPrincipal(gatewayLocals(), requestUrl({ agentId: AGENT_A })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it.each([{ agentId: AGENT_A }, { userId: PROFILE_A }])(
    'preserves browser self resolution for %j',
    async (params) => {
      const principal = await resolveAssistantPrincipal(browserLocals(), requestUrl(params));
      expect(principal).toMatchObject({ principalId: PROFILE_A, orgId: ORG_A });
    },
  );

  it('preserves browser admin delegation to another current member', async () => {
    const principal = await resolveAssistantPrincipal(
      browserLocals(PROFILE_A, 'admin'),
      requestUrl({ agentId: AGENT_B, orgId: ORG_B }),
    );
    expect(principal).toMatchObject({ principalId: PROFILE_B, orgId: ORG_B });
  });

  it('denies browser nonadmin delegation to another persisted actor', async () => {
    await expect(
      resolveAssistantPrincipal(browserLocals(), requestUrl({ agentId: AGENT_B })),
    ).rejects.toMatchObject({ status: 403 });
    expect(requests).toEqual([]);
  });

  it('preserves browser admin brain scope while gateway brain delegation remains unavailable', async () => {
    const principal = await resolveAssistantPrincipal(
      browserLocals(PROFILE_A, 'admin'),
      requestUrl({ agentId: BRAIN }),
    );
    expect(principal.capabilities.can('brains', 'view')).toBe(true);
    expect(principal.capabilities.can('finance', 'view')).toBe(false);
    await expect(
      resolveAssistantPrincipal(gatewayLocals(), requestUrl({ agentId: BRAIN })),
    ).rejects.toMatchObject({ status: 403, body: { code: 'ASSISTANT_BRAIN_ASSIGNMENT_REQUIRED' } });
  });
});
