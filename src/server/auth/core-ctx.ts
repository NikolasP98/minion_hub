import { getCoreDb } from '$server/db/pg-client';
import { getTenantCtx } from '$server/auth/tenant-ctx';

/**
 * Core (Supabase-Postgres) tenant context: the relational-core db handle +
 * the resolved org (tenant) id. The generic equivalent of `getFlowsCtx` /
 * `getNotesCtx`, for any tenant-scoped domain whose storage has moved off
 * Turso onto Supabase (`@minion-stack/db/pg`).
 *
 * tenant_id on the pg rows is a cross-DB reference to the org id resolved from
 * Turso by `getTenantCtx` — valid because the canonical org id is shared across
 * both stores (same pattern as flows / notes).
 */
export interface CoreCtx {
  db: ReturnType<typeof getCoreDb>;
  tenantId: string;
}

export async function getCoreCtx(locals: App.Locals): Promise<CoreCtx | null> {
  const base = await getTenantCtx(locals);
  if (!base) return null;
  return { db: getCoreDb(), tenantId: base.tenantId };
}
