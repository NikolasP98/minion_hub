import { error } from '@sveltejs/kit';
import { getDb } from '$server/db/client';
import { supabaseAdmin } from '$server/supabase';
import type { TenantContext } from '$server/services/base';

/**
 * Resolve tenant context: use existing locals, else fall back to the first
 * Supabase organization. Returns null only if no organization exists at all.
 * The fallback is rare — resolveIdentity normally sets locals.tenantCtx. The
 * Turso `db` handle is kept on the ctx for telemetry/servers reads; only the
 * tenantId needs to be the canonical Supabase org id.
 */
export async function getTenantCtx(locals: App.Locals): Promise<TenantContext | null> {
  if (locals.tenantCtx) return locals.tenantCtx;
  const { data } = await supabaseAdmin().from('organizations').select('id').limit(1).maybeSingle();
  if (!data) return null;
  return { db: getDb(), tenantId: (data as { id: string }).id };
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
