/**
 * Gateway (libsql) — tenants, servers, agents, sessions, session_tasks,
 * chat_messages. `personal_agents` is NOT here — see the recon disagreement
 * note at the top of tenancy.ts, that table now lives in Postgres.
 *
 * `tenants` is the REAL applied FK target for servers/agents/sessions/…
 * (`drizzle/0000_previous_phantom_reporter.sql`), not the `organization`
 * table the newer `@minion-stack/db/src/schema/auth/*` (Better Auth) files
 * declare — that schema was never applied to this database. One `tenants`
 * row per Postgres org id keeps the libsql FKs satisfied.
 */
import { matrixTextId } from './ids';
import { ORG_BUSINESS } from './tenancy';
import type { SeedContext } from './db';

const ARCHETYPES = ['copilot', 'brain', 'autonomous'] as const;

export async function seed(ctx: SeedContext): Promise<void> {
  const { libsql, register, now } = ctx;
  const ms = now.getTime();

  await libsql.execute({
    sql: 'insert into tenants (id, name, slug, plan, created_at, updated_at) values (?, ?, ?, ?, ?, ?) on conflict(id) do update set name = excluded.name',
    args: [ORG_BUSINESS, 'QA Business Org', 'qa-business', 'free', ms, ms],
  });

  const serverId = matrixTextId('gateway.server.business');
  await libsql.execute({
    sql: 'insert into servers (id, tenant_id, name, url, auth_mode, last_connected_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?) on conflict(id) do update set name = excluded.name',
    args: [
      serverId,
      ORG_BUSINESS,
      'QA Gateway Server',
      'http://127.0.0.1:18790',
      'none',
      null,
      ms,
      ms,
    ],
  });
  register('gateway.server.business', { table: 'servers', where: { id: serverId } });

  for (const archetype of ARCHETYPES) {
    const agentId = matrixTextId(`gateway.agent.${archetype}`);
    await libsql.execute({
      sql: 'insert into agents (id, server_id, tenant_id, name, description, model, status, raw_json, last_seen_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict(id, server_id) do update set name = excluded.name',
      args: [
        agentId,
        serverId,
        ORG_BUSINESS,
        `QA ${archetype} agent`,
        `QA fixture agent, archetype=${archetype}`,
        'claude-sonnet',
        'active',
        JSON.stringify({ archetype }),
        ms,
      ],
    });
    register(`gateway.agent.${archetype}`, {
      table: 'agents',
      where: { id: agentId, server_id: serverId },
    });
  }

  const sessionWithTasks = matrixTextId('gateway.session.with-tasks');
  const sessionWithoutTasks = matrixTextId('gateway.session.without-tasks');
  const copilotAgentId = matrixTextId('gateway.agent.copilot');
  for (const [matrixId, sessionId, sessionKey] of [
    ['gateway.session.with-tasks', sessionWithTasks, 'qa-session-with-tasks'],
    ['gateway.session.without-tasks', sessionWithoutTasks, 'qa-session-without-tasks'],
  ] as const) {
    await libsql.execute({
      sql: 'insert into sessions (id, tenant_id, server_id, agent_id, session_key, status, started_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict(id) do update set status = excluded.status',
      args: [sessionId, ORG_BUSINESS, serverId, copilotAgentId, sessionKey, 'idle', ms, ms, ms],
    });
    register(matrixId, { table: 'sessions', where: { id: sessionId } });
  }

  for (let i = 0; i < 3; i += 1) {
    await libsql.execute({
      sql: 'insert into session_tasks (id, tenant_id, server_id, session_key, title, status, sort_order, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict(id) do update set status = excluded.status',
      args: [
        matrixTextId('gateway.session.with-tasks', `task-${i}`),
        ORG_BUSINESS,
        serverId,
        'qa-session-with-tasks',
        `QA task ${i + 1}`,
        i === 0 ? 'done' : 'backlog',
        i,
        ms,
        ms,
      ],
    });
  }

  // chat_messages has no natural key (bare autoincrement id) — guard the
  // insert with NOT EXISTS on (session_key, timestamp) so a re-run is a no-op
  // instead of ten more rows every time.
  for (let i = 0; i < 10; i += 1) {
    await libsql.execute({
      sql: `insert into chat_messages (tenant_id, server_id, agent_id, session_key, role, content, timestamp, created_at)
            select ?, ?, ?, ?, ?, ?, ?, ?
            where not exists (select 1 from chat_messages where session_key = ? and timestamp = ?)`,
      args: [
        ORG_BUSINESS,
        serverId,
        copilotAgentId,
        'qa-session-with-tasks',
        i % 2 === 0 ? 'user' : 'assistant',
        `QA chat message ${i + 1}`,
        ms + i,
        ms + i,
        'qa-session-with-tasks',
        ms + i,
      ],
    });
  }
}
