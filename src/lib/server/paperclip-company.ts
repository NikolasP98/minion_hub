import type { RequestEvent } from '@sveltejs/kit';
import { supabaseAdmin } from '$server/supabase';
import { paperclipServerClient } from '$lib/server/paperclip-fetch';

/**
 * org → paperclip company bridge. The active hub org (Supabase `organizations`)
 * owns exactly one paperclip company via `organizations.paperclip_company_id`.
 */

/** Read the paperclip company id mapped to a hub org. null if unmapped. */
export async function getOrgCompanyId(orgId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from('organizations')
    .select('paperclip_company_id')
    .eq('id', orgId)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { paperclip_company_id: string | null }).paperclip_company_id ?? null;
}

/**
 * Ensure the org has a paperclip company, creating one named after the org if
 * not. Idempotent and race-safe: the persist is a conditional update gated on
 * `paperclip_company_id is null`; if a concurrent request won, we archive the
 * company we just created and return the winner.
 *
 * Throws if paperclip company creation fails (e.g. 403 when the hub board key is
 * not an instance admin). Callers should catch and route to /workforce/welcome.
 */
export async function provisionOrgCompany(
  event: RequestEvent,
  orgId: string,
  orgName: string,
): Promise<string> {
  const existing = await getOrgCompanyId(orgId);
  if (existing) return existing;

  const client = paperclipServerClient(event);
  const company = await client.companies.create({ name: orgName });

  const { data, error } = await supabaseAdmin()
    .from('organizations')
    .update({ paperclip_company_id: company.id })
    .eq('id', orgId)
    .is('paperclip_company_id', null)
    .select('paperclip_company_id');

  if (error) {
    // Persist failed for a non-race reason. Archive the orphan company we just
    // created so we don't leak it, then surface the error.
    await client.companies.archive(company.id).catch(() => {});
    throw new Error(`failed to persist paperclip company mapping: ${error.message}`);
  }

  if (Array.isArray(data) && data.length > 0) {
    return company.id; // we won the race
  }

  // 0 rows updated → a concurrent request mapped the org first.
  const winner = await getOrgCompanyId(orgId);
  if (!winner) {
    throw new Error('paperclip company persist updated no rows but no existing mapping found');
  }
  if (winner !== company.id) {
    await client.companies.archive(company.id).catch(() => {});
  }
  return winner;
}
