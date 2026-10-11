/**
 * RLS contract for `app_notifications` / `app_notification_reads`
 * (supabase/migrations/20261011100000_app_notifications.sql). Skips unless
 * `HUB_TEST_DB_URL` is set (same convention as every other
 * `*.sql.integration.test.ts` — see src/server/test-utils/test-db-url.ts).
 *
 * This proves the migration's own guarantee at the SQL layer: a global row
 * (org_id null) is visible under ANY org's GUC; an org-scoped row is visible
 * only under its own org's GUC. inbox.service.ts's role/user capability
 * intersection is an application-layer filter ON TOP of this and is not
 * re-proven here — see the mocked route tests under src/routes/api/inbox/**.
 */
import postgres from 'postgres';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDatabaseUrl } from '../test-utils/test-db-url';

const dbUrl = testDatabaseUrl();

describe.skipIf(!dbUrl)('app_notifications RLS (org_guc)', () => {
  let sql: ReturnType<typeof postgres>;
  const orgA = 'qa-inbox-rls-org-a';
  const orgB = 'qa-inbox-rls-org-b';
  let globalId: string;
  let orgAId: string;

  beforeAll(async () => {
    sql = postgres(dbUrl!, { prepare: false, max: 1 });
    const [g] = await sql`
      insert into app_notifications (scope, org_id, kind, title, dedupe_key)
      values ('global', null, 'app.update', 'RLS test global', 'qa-inbox-rls:global')
      on conflict (dedupe_key) do update set title = excluded.title
      returning id
    `;
    globalId = g.id;
    const [o] = await sql`
      insert into app_notifications (scope, org_id, kind, title, dedupe_key)
      values ('org', ${orgA}, 'org.notice', 'RLS test org-a', 'qa-inbox-rls:org-a')
      on conflict (dedupe_key) do update set title = excluded.title
      returning id
    `;
    orgAId = o.id;
  });

  afterAll(async () => {
    await sql`delete from app_notifications where dedupe_key like 'qa-inbox-rls:%'`;
    await sql.end();
  });

  async function visibleIdsUnder(orgId: string): Promise<string[]> {
    return sql.begin(async (tx) => {
      await tx`select set_config('role', 'app_ledger', true), set_config('app.current_org_id', ${orgId}, true)`;
      const rows =
        await tx`select id from app_notifications where dedupe_key like 'qa-inbox-rls:%'`;
      return rows.map((r) => r.id as string);
    });
  }

  it('shows the global row under any org GUC', async () => {
    expect(await visibleIdsUnder(orgA)).toContain(globalId);
    expect(await visibleIdsUnder(orgB)).toContain(globalId);
  });

  it('hides an org-scoped row from a different org GUC', async () => {
    expect(await visibleIdsUnder(orgA)).toContain(orgAId);
    expect(await visibleIdsUnder(orgB)).not.toContain(orgAId);
  });
});
