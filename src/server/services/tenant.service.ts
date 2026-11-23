import { supabaseAdmin } from '$server/supabase';
import type { TenantContext } from './base';
import { saveOrganizationMetadata } from './organization-branding.service';

/**
 * Org info for the active tenant — Supabase `organizations` (the single tenancy
 * store). `logo`/`metadata` are not modeled in Supabase organizations, so they
 * are omitted (they were unused legacy Turso columns).
 */
export async function getTenant(ctx: TenantContext) {
  const { data, error } = await supabaseAdmin()
    .from('organizations')
    .select('id, name, hub_name, slug, status, created_at, kind')
    .eq('id', ctx.tenantId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** Both automatic identity source fields share the locked owner boundary. */
export async function updateTenant(locals: App.Locals, data: unknown) {
  return saveOrganizationMetadata(locals, data);
}
