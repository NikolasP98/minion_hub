import { sql } from 'drizzle-orm';
import type { getCoreDb } from './pg-client';

type CoreDb = ReturnType<typeof getCoreDb>;

/** The transaction handle handed to `withOrgCore` callbacks. */
export type CoreTx = Parameters<Parameters<CoreDb['transaction']>[0]>[0];

/** Minimal shape `withOrgCore` needs — satisfied by CoreCtx / ServerCtx, or any
 *  `{ db, tenantId }`. Taking the context (not a bare org id) means the txn runs
 *  on the caller's db handle, so tests that inject a mock db exercise the same
 *  path. */
export interface OrgScope {
  db: CoreDb;
  tenantId: string;
  /** Acting hub user (profiles.id). When set, exposed as the `app.current_profile_id`
   *  GUC inside the txn — the basis for record-level (if-owner) scoping. */
  profileId?: string | null;
}

/**
 * Run `fn` in a core-db transaction scoped to one org, with RLS ENFORCED.
 *
 * The hub connects to Supabase as `postgres` (rolbypassrls=true), so plain
 * `getCoreDb()` queries bypass every row-level-security policy — server-side
 * isolation then rests entirely on each service remembering its `tenant_id`
 * filter. This helper closes that bypass: inside the txn we
 * `SET LOCAL ROLE app_ledger` (a non-bypass role) and set the
 * `app.current_org_id` GUC, so the per-table `<table>_org_guc` policies
 * (`tenant_id::text = current_setting('app.current_org_id', true)`) take over.
 * A forgotten filter can no longer leak across orgs. Both the role and the GUC
 * reset at commit — nothing leaks across pooled connections.
 *
 * Mirrors `withOrg` (the messages/agent_memories ledger client) but runs on the
 * relational-core client carried by the context. Use it for every org-scoped
 * core table once that table has its `*_org_guc` policy + `force row level
 * security`.
 *
 * `scope.tenantId` MUST be the canonical org id (organizations.id as text).
 */
export function withOrgCore<T>(scope: OrgScope, fn: (tx: CoreTx) => Promise<T>): Promise<T> {
  if (!scope.tenantId) throw new Error('withOrgCore requires a non-empty tenantId');
  return scope.db.transaction(async (tx) => {
    await tx.execute(sql`set local role app_ledger`);
    await tx.execute(sql`select set_config('app.current_org_id', ${scope.tenantId}, true)`);
    // Record-level scoping basis (if-owner). Always set (empty when unknown) so a
    // pooled connection never inherits a previous request's profile id.
    await tx.execute(sql`select set_config('app.current_profile_id', ${scope.profileId ?? ''}, true)`);
    return fn(tx);
  });
}
