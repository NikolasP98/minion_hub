#!/usr/bin/env bun
/**
 * Read-only two-source re-key readiness audit for
 * specs/2026-08-18-hub-updateserver-tenant-scope-spec.md Slice 1.
 *
 * Proves every Turso `servers.tenant_id` is non-null and exactly equals one
 * current canonical Supabase `organizations.id` — the prerequisite for Slice 2
 * to add `eq(servers.tenantId, ctx.tenantId)` to updateServer's WHERE clause
 * without silently no-op'ing every same-tenant update. The two databases are
 * physically separate and cannot be joined in SQL, so this script fetches each
 * side separately (read-only) and compares exact string values in application
 * memory. It never writes to either database.
 *
 * Run (non-production, then production — attach both outputs to the PR):
 *   TURSO_DB_URL=... TURSO_DB_AUTH_TOKEN=... \
 *   PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   bun scripts/audit-server-tenant-scope.ts
 *
 * Exit 0 + `null_tenant_ids=0 unmatched_tenant_ids=0` means re-key readiness
 * is proven. Any other exit code (or nonzero counts) means Slice 2 must not
 * proceed until the underlying re-key/data issue is resolved.
 *
 * TODO(handoff): this script has NOT been executed against non-production or
 * production — this sandbox has no TURSO_DB_URL/TURSO_DB_AUTH_TOKEN/
 * PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY for either environment, and an
 * agent must never fabricate or guess at those values or their output. This is
 * a hard, unresolved BLOCKER on Slice 1: per spec Slice 1 work items 3-4 and
 * the DELTA table's Slice 1 row, a human holding real credentials must run this
 * script against non-production, then production, and attach both command
 * outputs (each must print `null_tenant_ids=0 unmatched_tenant_ids=0`), plus
 * the concrete re-key migration/deployment apply evidence and a rollback/
 * recovery note, to the PR before Slice 1 is accepted and before any Slice 2
 * work starts. Pointer: specs/2026-08-18-hub-updateserver-tenant-scope-spec.md
 * (this repo's FACTORY_SPEC.md), Slice 1 Definition of done.
 */
import { drizzle } from 'drizzle-orm/libsql';
import { createClient as createLibsqlClient } from '@libsql/client';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { servers } from '@minion-stack/db/schema';

async function main() {
  // No fallback to the app's dev-default `file:./data/minion_hub.db` — this is a
  // production-proof command. A missing/mistyped TURSO_DB_URL must abort, not
  // silently audit an empty local sqlite file and report a false PASS.
  const tursoUrl = process.env.TURSO_DB_URL;
  const tursoAuthToken = process.env.TURSO_DB_AUTH_TOKEN;
  if (!tursoUrl || !tursoAuthToken) {
    throw new Error('TURSO_DB_URL and TURSO_DB_AUTH_TOKEN must be set');
  }
  const libsqlClient = createLibsqlClient({ url: tursoUrl, authToken: tursoAuthToken });
  const db = drizzle(libsqlClient, { schema: { servers } });

  const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }
  const supabase = createSupabaseClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Source 1: every Turso servers row, read-only, unfiltered.
  const serverRows = await db.select({ id: servers.id, tenantId: servers.tenantId }).from(servers);

  // Source 2: every canonical Supabase organization id, read-only, paginated.
  const orgIds = new Set<string>();
  const PAGE_SIZE = 1000;
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('organizations')
      .select('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Supabase organizations read failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data as Array<{ id: string }>) orgIds.add(row.id);
    if (data.length < PAGE_SIZE) break;
  }

  let nullTenantIds = 0;
  let unmatchedTenantIds = 0;
  const unmatchedSample: string[] = [];
  for (const row of serverRows) {
    if (row.tenantId == null || row.tenantId === '') {
      nullTenantIds++;
      continue;
    }
    // Multiple servers sharing a tenant id is valid and not counted here —
    // this only flags tenant ids absent from the canonical Supabase set.
    if (!orgIds.has(row.tenantId)) {
      unmatchedTenantIds++;
      if (unmatchedSample.length < 10) unmatchedSample.push(row.id);
    }
  }

  console.log(
    `turso_server_rows=${serverRows.length} null_tenant_ids=${nullTenantIds} unmatched_tenant_ids=${unmatchedTenantIds}`,
  );
  if (unmatchedSample.length > 0) {
    console.log(`[audit] sample unmatched server ids: ${unmatchedSample.join(', ')}`);
  }

  libsqlClient.close();

  if (nullTenantIds > 0 || unmatchedTenantIds > 0) {
    console.error('[audit] FAIL — re-key readiness not proven; Slice 2 must not proceed');
    process.exit(1);
  }
  console.log(
    '[audit] PASS — every Turso servers.tenant_id matches a canonical Supabase organizations.id',
  );
}

main().catch((err) => {
  console.error('[audit] failed:', err);
  process.exit(1);
});
