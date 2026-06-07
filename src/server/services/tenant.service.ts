import { supabaseAdmin } from '$server/supabase';
import type { TenantContext } from './base';

/**
 * Org info for the active tenant — Supabase `organizations` (the single tenancy
 * store). `logo`/`metadata` are not modeled in Supabase organizations, so they
 * are omitted (they were unused legacy Turso columns).
 */
export async function getTenant(ctx: TenantContext) {
  const { data, error } = await supabaseAdmin()
    .from('organizations')
    .select('id, name, slug, status, created_at')
    .eq('id', ctx.tenantId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function updateTenant(
  ctx: TenantContext,
  data: { name?: string; slug?: string; logo?: string; metadata?: string },
) {
  const set: Record<string, unknown> = {};
  if (data.name !== undefined) set.name = data.name;
  if (data.slug !== undefined) set.slug = data.slug;
  if (Object.keys(set).length === 0) return;
  const { error } = await supabaseAdmin().from('organizations').update(set).eq('id', ctx.tenantId);
  if (error) throw error;
}
