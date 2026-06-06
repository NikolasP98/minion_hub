import { sql } from 'drizzle-orm';
import { getCoreDb } from './pg-client';

type CoreDb = ReturnType<typeof getCoreDb>;

/** The transaction handle handed to `withOrgCore` callbacks. */
export type CoreTx = Parameters<Parameters<CoreDb['transaction']>[0]>[0];

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
 * This mirrors `withOrg` (the messages/agent_memories ledger client) but runs
 * on the relational-core client (`getCoreDb`). Use it for every org-scoped core
 * table once that table has its `*_org_guc` policy + `force row level security`.
 *
 * `orgId` MUST be the canonical org id (organizations.id as text — the value
 * carried by `CoreCtx.tenantId`).
 */
export function withOrgCore<T>(orgId: string, fn: (tx: CoreTx) => Promise<T>): Promise<T> {
  if (!orgId) throw new Error('withOrgCore requires a non-empty orgId');
  return getCoreDb().transaction(async (tx) => {
    await tx.execute(sql`set local role app_ledger`);
    await tx.execute(sql`select set_config('app.current_org_id', ${orgId}, true)`);
    return fn(tx);
  });
}
