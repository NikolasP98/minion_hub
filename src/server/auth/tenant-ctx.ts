import { error } from '@sveltejs/kit';
import { setAiUsageOrg } from '$server/ai-usage';
import type { TenantContext } from '$server/services/base';

/**
 * Use only the tenant resolved by the authenticated identity provider.
 * A user or orgId alone does not establish organization authority. No-tenant
 * callers must enroll or resolve membership before accessing tenant data.
 */
export async function getTenantCtx(locals: App.Locals): Promise<TenantContext | null> {
  if (locals.tenantCtx) {
    // Every tenant-scoped request funnels through here, which makes it the one
    // place that always knows the org — so it is where the AI usage ledger picks
    // up its attribution. See `$server/ai-usage`.
    setAiUsageOrg(locals.tenantCtx.tenantId);
    return locals.tenantCtx;
  }
  return null;
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
