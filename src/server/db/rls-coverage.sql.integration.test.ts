/**
 * Every public base table with an `org_id` / `tenant_id` column must have
 * RLS enabled + FORCED and at least one policy that reads `current_org_id`
 * (the `_org_guc` convention). Debt is explicit in rls-coverage.allowlist.json;
 * an allowlisted table that stops matching the scan fails too, so the list
 * cannot rot. Spec 048 (meta repo) slice H1. Skips unless `HUB_TEST_DB_URL`.
 */
import postgres from 'postgres';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDatabaseUrl } from '../test-utils/test-db-url';
import allowlist from './rls-coverage.allowlist.json';

const dbUrl = testDatabaseUrl();

describe.skipIf(!dbUrl)('RLS coverage of org-scoped tables', () => {
  let sql: ReturnType<typeof postgres>;
  let tables: string[];
  let uncovered: Set<string>;

  beforeAll(async () => {
    sql = postgres(dbUrl!, { prepare: false, max: 1 });
    const rows = await sql`
      select c.relname as t,
             c.relrowsecurity and c.relforcerowsecurity as forced,
             exists (
               select 1 from pg_policies p
               where p.schemaname = 'public' and p.tablename = c.relname
                 and (p.qual ilike '%current_org_id%' or p.with_check ilike '%current_org_id%')
             ) as has_policy
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      where c.relkind in ('r', 'p')
        and exists (
          select 1 from information_schema.columns ic
          where ic.table_schema = 'public' and ic.table_name = c.relname
            and ic.column_name in ('org_id', 'tenant_id')
        )
      order by 1`;
    tables = rows.map((r) => r.t as string);
    uncovered = new Set(rows.filter((r) => !(r.forced && r.has_policy)).map((r) => r.t as string));
  });

  afterAll(async () => {
    await sql.end();
  });

  it('every org table is forced-RLS with a current_org_id policy, or allowlisted', () => {
    const listed = new Set(allowlist.map((e) => e.table));
    expect([...uncovered].filter((t) => !listed.has(t))).toEqual([]);
  });

  it('every allowlisted table still exists and is still uncovered', () => {
    const stale = allowlist
      .map((e) => e.table)
      .filter((t) => !tables.includes(t) || !uncovered.has(t));
    expect(stale).toEqual([]);
  });
});
