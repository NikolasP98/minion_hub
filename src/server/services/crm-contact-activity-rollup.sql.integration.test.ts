import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { loadEnv } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl =
  process.env.SUPABASE_DB_URL ?? loadEnv('development', process.cwd(), '').SUPABASE_DB_URL;

if (process.env.REQUIRE_CRM_ACTIVITY_ROLLUP_POSTGRES && !databaseUrl) {
  throw new Error(
    'REQUIRE_CRM_ACTIVITY_ROLLUP_POSTGRES is set but SUPABASE_DB_URL is empty — the CRM activity rollup suite requires PostgreSQL.',
  );
}

const client = databaseUrl
  ? postgres(databaseUrl, { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 10 })
  : null;
const schema = `crm_activity_${process.pid}_${Math.random().toString(36).slice(2)}`;
const org = 'org-rollup-test';
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function migrationForTestSchema(): string[] {
  const source = readFileSync(
    new URL(
      '../../../supabase/migrations/20260825100000_crm_contact_activity_rollup.sql',
      import.meta.url,
    ),
    'utf8',
  );
  return source
    .replaceAll('public.', `"${schema}".`)
    .replaceAll('set search_path = public, pg_temp', `set search_path = "${schema}", pg_temp`)
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean)
    .filter(
      (statement) =>
        !/^grant\s/iu.test(statement) &&
        !/^alter table .* row level security/isu.test(statement) &&
        !/^drop policy/iu.test(statement) &&
        !/^create policy/iu.test(statement),
    );
}

describe.runIf(Boolean(databaseUrl))('crm_contact_activity_stats migration', () => {
  beforeAll(async () => {
    await client!.unsafe(`create schema "${schema}"`);
    await client!.unsafe(`set search_path to "${schema}"`);
    await client!.unsafe(`
      create table crm_contacts (
        id uuid primary key,
        org_id text not null
      );
      create table crm_contact_identities (
        id uuid primary key default gen_random_uuid(),
        org_id text not null,
        contact_id uuid not null references crm_contacts(id) on delete cascade,
        channel text not null,
        external_id text not null,
        unique (org_id, channel, external_id)
      );
      create table messages (
        id uuid primary key default gen_random_uuid(),
        client_id text not null unique,
        org_id text not null,
        channel text not null,
        chat_id text,
        direction text not null,
        is_bot boolean,
        sender_name text,
        occurred_at timestamptz,
        created_at timestamptz not null default now()
      );
    `);

    // Existing rows exercise the migration's initial full backfill.
    await client!.unsafe(`insert into crm_contacts (id, org_id) values ($1, $3), ($2, $3)`, [
      id(1),
      id(2),
      org,
    ]);
    await client!.unsafe(
      `insert into crm_contact_identities (org_id, contact_id, channel, external_id)
       values ($1, $2, 'whatsapp', 'existing-chat')`,
      [org, id(1)],
    );
    await client!.unsafe(
      `insert into messages (client_id, org_id, channel, chat_id, direction, is_bot, occurred_at)
       values ('existing-in', $1, 'whatsapp', 'existing-chat', 'inbound', false, '2026-08-01T10:00:00Z'),
              ('existing-out', $1, 'whatsapp', 'existing-chat', 'outbound', false, '2026-08-02T10:00:00Z')`,
      [org],
    );

    for (const statement of migrationForTestSchema()) await client!.unsafe(statement);
  }, 30_000);

  afterAll(async () => {
    if (!client) return;
    await client.unsafe(`drop schema if exists "${schema}" cascade`);
    await client.end({ timeout: 5 });
  });

  it('backfills existing identities and keeps zero-message contacts explicit', async () => {
    const rows = await client!.unsafe<Array<Record<string, unknown>>>(
      `select contact_id::text, message_count::int, inbound_count::int, outbound_count::int,
              channels_used, first_contact_at::text, last_contact_at::text
       from crm_contact_activity_stats order by contact_id`,
    );
    expect(rows).toMatchObject([
      {
        contact_id: id(1),
        message_count: 2,
        inbound_count: 1,
        outbound_count: 1,
        channels_used: 1,
      },
      {
        contact_id: id(2),
        message_count: 0,
        inbound_count: 0,
        outbound_count: 0,
        channels_used: 0,
      },
    ]);
  });

  it('rebuilds history when a message arrived before its identity', async () => {
    await client!.unsafe(`insert into crm_contacts (id, org_id) values ($1, $2)`, [id(3), org]);
    await client!.unsafe(
      `insert into messages (client_id, org_id, channel, chat_id, direction, is_bot)
       values ('before-identity', $1, 'instagram', 'late-chat', 'inbound', false)`,
      [org],
    );
    await client!.unsafe(
      `insert into crm_contact_identities (org_id, contact_id, channel, external_id)
       values ($1, $2, 'instagram', 'late-chat')`,
      [org, id(3)],
    );

    const [row] = await client!.unsafe<Array<Record<string, number>>>(
      `select message_count::int, inbound_count::int from crm_contact_activity_stats where contact_id = $1`,
      [id(3)],
    );
    expect(row).toMatchObject({ message_count: 1, inbound_count: 1 });
  });

  it('increments new messages, ignores bot rows, and does not double-count duplicate upserts', async () => {
    await client!.unsafe(`insert into crm_contacts (id, org_id) values ($1, $2)`, [id(4), org]);
    await client!.unsafe(
      `insert into crm_contact_identities (org_id, contact_id, channel, external_id)
       values ($1, $2, 'whatsapp', 'new-chat')`,
      [org, id(4)],
    );
    await client!.unsafe(
      `insert into messages (client_id, org_id, channel, chat_id, direction, is_bot, sender_name)
       values ('new-message', $1, 'whatsapp', 'new-chat', 'outbound', false, 'first')`,
      [org],
    );
    await client!.unsafe(
      `insert into messages (client_id, org_id, channel, chat_id, direction, is_bot, sender_name)
       values ('new-message', $1, 'whatsapp', 'new-chat', 'outbound', false, 'updated')
       on conflict (client_id) do update set sender_name = excluded.sender_name`,
      [org],
    );
    await client!.unsafe(
      `insert into messages (client_id, org_id, channel, chat_id, direction, is_bot)
       values ('bot-message', $1, 'whatsapp', 'new-chat', 'inbound', true)`,
      [org],
    );

    const [row] = await client!.unsafe<Array<Record<string, number>>>(
      `select message_count::int, inbound_count::int, outbound_count::int
       from crm_contact_activity_stats where contact_id = $1`,
      [id(4)],
    );
    expect(row).toMatchObject({ message_count: 1, inbound_count: 0, outbound_count: 1 });
  });

  it('tracks distinct channels and rebuilds both sides of identity reassignment/deletion', async () => {
    await client!.unsafe(
      `insert into crm_contacts (id, org_id) values ($1, $4), ($2, $4), ($3, $4)`,
      [id(5), id(6), id(7), org],
    );
    await client!.unsafe(
      `insert into crm_contact_identities (org_id, contact_id, channel, external_id) values
       ($1, $2, 'whatsapp', 'merge-wa'),
       ($1, $2, 'instagram', 'merge-ig'),
       ($1, $3, 'messenger', 'delete-me')`,
      [org, id(6), id(7)],
    );
    await client!.unsafe(
      `insert into messages (client_id, org_id, channel, chat_id, direction, is_bot) values
       ('merge-wa-1', $1, 'whatsapp', 'merge-wa', 'inbound', false),
       ('merge-ig-1', $1, 'instagram', 'merge-ig', 'outbound', false),
       ('delete-1', $1, 'messenger', 'delete-me', 'inbound', false)`,
      [org],
    );

    await client!.unsafe(
      `update crm_contact_identities set contact_id = $1 where contact_id = $2`,
      [id(5), id(6)],
    );
    await client!.unsafe(`delete from crm_contact_identities where contact_id = $1`, [id(7)]);

    const rows = await client!.unsafe<Array<Record<string, unknown>>>(
      `select contact_id::text, message_count::int, channels_used
       from crm_contact_activity_stats where contact_id = any($1::uuid[]) order by contact_id`,
      [[id(5), id(6), id(7)]],
    );
    expect(rows).toEqual([
      { contact_id: id(5), message_count: 2, channels_used: 2 },
      { contact_id: id(6), message_count: 0, channels_used: 0 },
      { contact_id: id(7), message_count: 0, channels_used: 0 },
    ]);
  });

  it('matches the authoritative live ledger aggregation field-for-field', async () => {
    const mismatches = await client!.unsafe<Array<Record<string, unknown>>>(`
      with live as (
        select c.id as contact_id,
               count(m.id)::bigint as message_count,
               count(m.id) filter (where m.direction = 'inbound')::bigint as inbound_count,
               count(m.id) filter (where m.direction = 'outbound')::bigint as outbound_count,
               count(distinct m.channel) filter (where m.id is not null)::int as channels_used,
               min(coalesce(m.occurred_at, m.created_at)) as first_contact_at,
               max(coalesce(m.occurred_at, m.created_at)) as last_contact_at,
               max(coalesce(m.occurred_at, m.created_at)) filter (where m.direction = 'inbound') as last_inbound_at,
               max(coalesce(m.occurred_at, m.created_at)) filter (where m.direction = 'outbound') as last_outbound_at
        from crm_contacts c
        left join crm_contact_identities ci on ci.contact_id = c.id and ci.org_id = c.org_id
        left join messages m
          on m.org_id = ci.org_id and m.channel = ci.channel and m.chat_id = ci.external_id
         and m.is_bot is not true
        group by c.id
      )
      select live.contact_id
      from live
      join crm_contact_activity_stats stats using (contact_id)
      where (live.message_count, live.inbound_count, live.outbound_count, live.channels_used,
             live.first_contact_at, live.last_contact_at, live.last_inbound_at, live.last_outbound_at)
        is distinct from
            (stats.message_count, stats.inbound_count, stats.outbound_count, stats.channels_used,
             stats.first_contact_at, stats.last_contact_at, stats.last_inbound_at, stats.last_outbound_at)
    `);
    expect(mismatches).toEqual([]);
  });
});
