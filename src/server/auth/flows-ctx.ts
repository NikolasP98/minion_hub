import { getCoreDb } from '$server/db/pg-client';
import { getTenantCtx } from '$server/auth/tenant-ctx';

/**
 * Flows context: the Supabase-Postgres core db + the resolved org (tenant) id.
 *
 * Flows storage lives in Supabase Postgres (via getCoreDb), NOT Turso. The org
 * id is still resolved from the Turso `organization` table by getTenantCtx, so
 * tenant_id on flow rows is a cross-DB reference to Turso's organization.id —
 * the same pattern join_request / join_link already use.
 */
export interface FlowsCtx {
  db: ReturnType<typeof getCoreDb>;
  tenantId: string;
}

export async function getFlowsCtx(locals: App.Locals): Promise<FlowsCtx | null> {
  const base = await getTenantCtx(locals);
  if (!base) return null;
  return { db: getCoreDb(), tenantId: base.tenantId };
}
