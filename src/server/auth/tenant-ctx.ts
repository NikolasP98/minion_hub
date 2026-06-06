import { error } from '@sveltejs/kit';
import { getDb } from '$server/db/client';
import { organization } from '@minion-stack/db/schema';
import type { TenantContext } from '$server/services/base';

/**
 * Resolve tenant context: use existing locals, fall back to first organization in DB.
 * Returns null only if no organization exists at all.
 */
export async function getTenantCtx(locals: App.Locals): Promise<TenantContext | null> {
  if (locals.tenantCtx) return locals.tenantCtx;
  const db = getDb();
  const rows = await db.select({ id: organization.id }).from(organization).limit(1);
  if (rows.length === 0) return null;
  return { db, tenantId: rows[0].id };
}

/**
 * Resolve tenant context or fail. Previously this auto-created a phantom
 * "Default" org in Turso when none could be resolved — but on cloud the orgs
 * live in Supabase, so the fabricated Turso org had no data and the UI showed a
 * non-existent "Default". Now we fail closed (403) instead: the caller's request
 * needs a real, resolved org, and a missing one means the session's tenancy
 * didn't resolve (handled upstream by resolveIdentity / the (app) layout).
 */
export async function getOrCreateTenantCtx(locals: App.Locals): Promise<TenantContext> {
  const ctx = await getTenantCtx(locals);
  if (ctx) return ctx;
  throw error(403, 'No active organization for this request');
}
