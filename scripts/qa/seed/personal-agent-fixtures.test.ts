import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { testDatabaseUrl } from '../../../src/server/test-utils/test-db-url';
import type { SeedContext } from './db';
import { ensureSeededPersonalAgent } from './tenancy';

const databaseUrl = testDatabaseUrl();

describe.skipIf(!databaseUrl)('QA personal-agent fixture provisioning', () => {
  let profileId = crypto.randomUUID();
  let originalAgentId = `personal-${profileId}`;
  let proposedReplacementId = `${originalAgentId}-replacement`;
  const triggerSuffix = crypto.randomUUID().replaceAll('-', '');
  const functionName = `qa_agent_fixture_fail_${triggerSuffix}`;
  const triggerName = `qa_agent_fixture_trigger_${triggerSuffix}`;
  let sql: ReturnType<typeof postgres>;
  let admin: SupabaseClient;

  beforeAll(async () => {
    sql = postgres(databaseUrl!, { prepare: false, max: 1 });
    const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) throw new Error('local Supabase admin env is required');
    admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const created = await admin.auth.admin.createUser({
      id: profileId,
      email: `${profileId}@qa.minion.test`,
      email_confirm: true,
    });
    if (created.error || !created.data.user) throw created.error ?? new Error('createUser failed');
    profileId = created.data.user.id;
    originalAgentId = `personal-${profileId}`;
    proposedReplacementId = `${originalAgentId}-replacement`;
    await sql`
      insert into profiles (id, email, display_name, role, account_type)
      values (${profileId}, ${`${profileId}@qa.minion.test`}, 'Synthetic agent fixture', 'user', 'person')
      on conflict (id) do update set display_name = excluded.display_name
    `;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe(`drop trigger if exists "${triggerName}" on profiles`);
    await sql.unsafe(`drop function if exists "${functionName}"()`);
    await admin?.auth.admin.deleteUser(profileId);
    await sql.end({ timeout: 5 });
  });

  function seedAgent(agentId = originalAgentId) {
    return ensureSeededPersonalAgent(
      { sql: sql as SeedContext['sql'] },
      { profileId, agentId, displayName: 'Synthetic personal agent' },
    );
  }

  it('creates the row and profile pointer, then leaves a valid row byte-for-byte stable', async () => {
    await seedAgent();
    const [before] = await sql<Record<string, unknown>[]>`
      select pa.*, p.personal_agent_id
      from personal_agents pa join profiles p on p.id = pa.profile_id
      where pa.profile_id = ${profileId}
    `;
    await seedAgent(proposedReplacementId);
    const [after] = await sql<Record<string, unknown>[]>`
      select pa.*, p.personal_agent_id
      from personal_agents pa join profiles p on p.id = pa.profile_id
      where pa.profile_id = ${profileId}
    `;
    expect(after).toEqual(before);
    expect(after?.agent_id).toBe(originalAgentId);
    expect(after?.personal_agent_id).toBe(originalAgentId);
  });

  it('repairs a failed row while preserving its persisted identity and display name', async () => {
    await sql`
      update personal_agents set provisioning_status = 'error', provisioning_error = 'local gateway absent',
        retry_count = 4, last_retry_at = now()
      where profile_id = ${profileId}
    `;
    await sql`update profiles set personal_agent_id = null where id = ${profileId}`;

    await seedAgent(proposedReplacementId);
    const [row] = await sql<
      {
        agent_id: string;
        display_name: string;
        provisioning_status: string;
        provisioning_error: string | null;
        retry_count: number;
        last_retry_at: Date | null;
        personal_agent_id: string | null;
      }[]
    >`
      select pa.agent_id, pa.display_name, pa.provisioning_status, pa.provisioning_error,
        pa.retry_count, pa.last_retry_at, p.personal_agent_id
      from personal_agents pa join profiles p on p.id = pa.profile_id
      where pa.profile_id = ${profileId}
    `;
    expect(row).toEqual({
      agent_id: originalAgentId,
      display_name: 'Synthetic personal agent',
      provisioning_status: 'active',
      provisioning_error: null,
      retry_count: 0,
      last_retry_at: null,
      personal_agent_id: originalAgentId,
    });
  });

  it('repairs only a missing pointer without changing the valid active agent row', async () => {
    const [before] = await sql<Record<string, unknown>[]>`
      select * from personal_agents where profile_id = ${profileId}
    `;
    await sql`update profiles set personal_agent_id = null where id = ${profileId}`;
    await seedAgent(proposedReplacementId);
    const [after] = await sql<Record<string, unknown>[]>`
      select * from personal_agents where profile_id = ${profileId}
    `;
    const [profile] = await sql<{ personal_agent_id: string | null }[]>`
      select personal_agent_id from profiles where id = ${profileId}
    `;
    expect(after).toEqual(before);
    expect(profile?.personal_agent_id).toBe(originalAgentId);
  });

  it('repairs a blank display name without replacing the persisted agent identity', async () => {
    await sql`update personal_agents set display_name = '' where profile_id = ${profileId}`;
    await seedAgent(proposedReplacementId);
    const [row] = await sql<{ agent_id: string; display_name: string }[]>`
      select agent_id, display_name from personal_agents where profile_id = ${profileId}
    `;
    expect(row).toEqual({ agent_id: originalAgentId, display_name: 'Synthetic personal agent' });
  });

  it('rolls back the agent repair if updating the profile pointer fails', async () => {
    await sql`
      update personal_agents set provisioning_status = 'error', provisioning_error = 'retry me'
      where profile_id = ${profileId}
    `;
    await sql`update profiles set personal_agent_id = null where id = ${profileId}`;
    await sql.unsafe(`
      create function "${functionName}"() returns trigger language plpgsql as $$
      begin
        if new.id = '${profileId}'::uuid then raise exception 'forced pointer failure'; end if;
        return new;
      end $$
    `);
    await sql.unsafe(`
      create trigger "${triggerName}" before update of personal_agent_id on profiles
      for each row execute function "${functionName}"()
    `);

    await expect(seedAgent()).rejects.toThrow(/forced pointer failure/);
    const [row] = await sql<{ status: string; error: string | null; pointer: string | null }[]>`
      select pa.provisioning_status as status, pa.provisioning_error as error,
        p.personal_agent_id as pointer
      from personal_agents pa join profiles p on p.id = pa.profile_id
      where pa.profile_id = ${profileId}
    `;
    expect(row).toEqual({ status: 'error', error: 'retry me', pointer: null });
  });
});
