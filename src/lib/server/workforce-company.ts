import type { RequestEvent } from '@sveltejs/kit';
import { supabaseAdmin } from '$server/supabase';
import { workforceRawFetch } from '$lib/server/workforce-fetch';

/**
 * Native single-id model: a hub org's Workforce company id IS the org id
 * (`company.id === organizations.id`). There is no separate mapping
 * table/column — the hub passes `orgId` as the `companyId` everywhere, and the
 * Workforce backend stores companies keyed by the org id (see backend migration
 * 0103 + create-with-id support).
 */

/**
 * Ensure a Workforce company exists with `id === orgId`, creating one named
 * after the org if missing. Idempotent. Returns the company id (== orgId).
 *
 * Throws if the backend is unreachable or rejects creation (e.g. 403 when the
 * hub board key is not an instance admin). Callers should catch and route to
 * /workforce/welcome.
 */
export async function ensureWorkforceCompany(event: RequestEvent, orgId: string): Promise<string> {
  // Fast path: company already exists at the org id.
  try {
    await workforceRawFetch(event, `/api/companies/${orgId}`);
    return orgId;
  } catch (e: any) {
    // Only a 404 means "not provisioned yet" — anything else (auth, backend
    // down) must bubble so the gate surfaces the right failure.
    if (e?.status !== 404) throw e;
  }

  const { data: org } = await supabaseAdmin()
    .from('organizations')
    .select('name')
    .eq('id', orgId)
    .maybeSingle();
  const name = (org as { name: string } | null)?.name ?? 'Workspace';

  // Create with id === orgId (backend createCompanySchema accepts an optional
  // id; restricted to instance-admin callers, which the hub board key is).
  const created = await workforceRawFetch<{ id: string }>(event, '/api/companies', {
    method: 'POST',
    body: JSON.stringify({ id: orgId, name }),
  });

  // Harden the single-id contract. A backend that silently ignores the
  // caller-supplied id (e.g. a deploy predating create-with-id, which strips it
  // and falls back to defaultRandom()) mints a fresh random-id company on EVERY
  // visit — the GET fast-path then never matches, so the gate loops on
  // no-company and leaks one orphan company per page load. Verify the id stuck;
  // if not, delete the orphan we just made and fail loudly so the gate routes to
  // provision-failed (a clear "backend rejected it" message) instead of leaking.
  if (created?.id !== orgId) {
    if (created?.id) {
      await workforceRawFetch(event, `/api/companies/${created.id}`, { method: 'DELETE' }).catch(
        () => {},
      );
    }
    throw Object.assign(new Error('workforce backend ignored caller-supplied company id'), {
      status: 409,
    });
  }
  return orgId;
}
