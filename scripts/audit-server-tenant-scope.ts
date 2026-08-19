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
 *   bun --no-env-file scripts/audit-server-tenant-scope.ts
 *
 * Exit 0 + `null_tenant_ids=0 unmatched_tenant_ids=0` means re-key readiness
 * is proven. Any other exit code (or nonzero counts) means Slice 2 must not
 * proceed until the underlying re-key/data issue is resolved.
 *
 * The comparison rules live in `./audit-server-tenant-scope.lib.ts` and are
 * covered by fixtures in `./audit-server-tenant-scope.test.ts`; this file is
 * only credential handling and read-only I/O.
 *
 * TODO(handoff): this script has NOT been executed against non-production or
 * production — this sandbox has no TURSO_DB_URL/TURSO_DB_AUTH_TOKEN/
 * PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY for either environment, and an
 * agent must never fabricate or guess at those values or their output. This is
 * a hard, unresolved BLOCKER on Slice 1: per spec Slice 1 work items 3-4 and
 * the DELTA table's Slice 1 row, a human holding real credentials must run this
 * script against non-production, then production, and attach all of the
 * following to the PR before Slice 1 is accepted and before any Slice 2 work
 * starts:
 *   1. the exact non-production command + output (`null_tenant_ids=0
 *      unmatched_tenant_ids=0`, and a non-zero `turso_server_rows`);
 *   2. the exact production command + output, same counters;
 *   3. the concrete re-key migration/deployment identifier and apply evidence
 *      (a planning-spec status alone is insufficient);
 *   4. the rollback/recovery note for that re-key.
 * The exact procedure, the pass/fail decision table, the rollback/recovery
 * statement and the PR evidence template are in
 * `docs/runbooks/server-tenant-scope-rekey-readiness.md`, so the credential
 * holder's remaining step is mechanical.
 * Pointer: specs/2026-08-18-hub-updateserver-tenant-scope-spec.md (this repo's
 * FACTORY_SPEC.md), Slice 1 Definition of done.
 */
import { drizzle } from 'drizzle-orm/libsql';
import { createClient as createLibsqlClient } from '@libsql/client';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { servers } from '@minion-stack/db/schema';
import {
  auditTenantScope,
  collectCanonicalOrgIds,
  formatAuditCounters,
} from './audit-server-tenant-scope.lib';

function requireEnv(...names: string[]): string[] {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length > 0) throw new Error(`${names.join(' and ')} must be set`);
  return names.map((name) => process.env[name] as string);
}

async function main() {
  // Every credential is validated before any connection is opened. There is no
  // fallback to the app's dev-default `file:./data/minion_hub.db` — this is a
  // production-proof command, and a missing/mistyped TURSO_DB_URL must abort
  // rather than silently audit an empty local sqlite file.
  const [tursoUrl, tursoAuthToken] = requireEnv('TURSO_DB_URL', 'TURSO_DB_AUTH_TOKEN');
  const [supabaseUrl, supabaseServiceRoleKey] = requireEnv(
    'PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  );

  const libsqlClient = createLibsqlClient({ url: tursoUrl, authToken: tursoAuthToken });
  let result;
  try {
    const db = drizzle(libsqlClient, { schema: { servers } });

    // Source 1: every Turso servers row, read-only, unfiltered.
    const serverRows = await db
      .select({ id: servers.id, tenantId: servers.tenantId })
      .from(servers);

    const supabase = createSupabaseClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Source 2: every canonical Supabase organization id, read-only, paginated.
    // `.order('id')` is required: an unordered range scan may repeat or SKIP
    // rows across pages, and a skipped organization id would be reported as a
    // false `unmatched_tenant_ids` hit.
    const orgIds = await collectCanonicalOrgIds(async (offset, limit) => {
      const { data, error } = await supabase
        .from('organizations')
        .select('id')
        .order('id', { ascending: true })
        .range(offset, offset + limit - 1);
      if (error) throw new Error(`Supabase organizations read failed: ${error.message}`);
      return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
    });

    result = auditTenantScope({ serverRows, orgIds });
  } finally {
    libsqlClient.close();
  }

  console.log(formatAuditCounters(result));
  if (result.unmatchedSample.length > 0) {
    console.log(`[audit] sample unmatched server ids: ${result.unmatchedSample.join(', ')}`);
  }

  if (!result.pass) {
    for (const reason of result.failReasons) console.error(`[audit] ${reason}`);
    console.error('[audit] FAIL — re-key readiness not proven; Slice 2 must not proceed');
    console.error('[audit] next steps: docs/runbooks/server-tenant-scope-rekey-readiness.md');
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
