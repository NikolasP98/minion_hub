import { redirect } from '@sveltejs/kit';
import { supabaseAdmin } from '$server/supabase';
import { provisionOrgCompany } from '$lib/server/workforce-company';
import type { LayoutServerLoad } from './$types';

/**
 * Single gate for the /workforce subtree. The active hub org owns one paperclip
 * company; if the org has none yet, lazily provision one named after the org and
 * expose its id to child loads via locals.workforceIdentity.companyId (set in
 * the same request so child +page.server.ts loads see it).
 */
export const load: LayoutServerLoad = async (event) => {
  if (!event.locals.user) throw redirect(302, '/login');

  // The welcome page is itself under this layout and is the redirect target for
  // the gate below — it must render WITHOUT being gated, or a no-org /
  // provision-failed user loops welcome → welcome forever.
  if (event.url.pathname === '/workforce/welcome') {
    return { companyId: null };
  }

  const orgId = event.locals.orgId ?? event.locals.tenantCtx?.tenantId ?? null;
  if (!orgId) throw redirect(302, '/workforce/welcome?reason=no-org');

  // Hook already resolved it for an existing mapping.
  let companyId = event.locals.workforceIdentity?.companyId ?? null;

  if (!companyId) {
    const { data: org } = await supabaseAdmin()
      .from('organizations')
      .select('name')
      .eq('id', orgId)
      .maybeSingle();
    const orgName = (org as { name: string } | null)?.name ?? 'Workspace';
    try {
      companyId = await provisionOrgCompany(event, orgId, orgName);
    } catch (err) {
      console.warn('[workforce] provisioning failed', err);
      throw redirect(302, '/workforce/welcome?reason=provision-failed');
    }
    // Make the freshly-provisioned id visible to child page loads this request.
    if (event.locals.workforceIdentity) {
      event.locals.workforceIdentity.companyId = companyId;
    }
  }

  return { companyId };
};
