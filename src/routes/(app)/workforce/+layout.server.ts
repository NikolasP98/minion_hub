import { redirect, error } from '@sveltejs/kit';
import { ensureWorkforceCompany } from '$lib/server/workforce-company';
import type { LayoutServerLoad } from './$types';

/**
 * Single gate for the /workforce subtree. Native single-id model: the active
 * hub org's Workforce company id IS the org id (company.id === org.id). Ensure
 * the company exists (lazily create it on first visit, named after the org) and
 * expose the id to child loads.
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

  // company.id === orgId. ensureWorkforceCompany is idempotent: it returns fast
  // when the company exists and creates it (with id=orgId) on first visit.
  try {
    await ensureWorkforceCompany(event, orgId);
  } catch (err) {
    const status = (err as { status?: number })?.status;
    // 5xx / network (no status) = backend unreachable → surface via +error.svelte
    // ("Workforce backend unavailable"). 4xx (e.g. 403 not instance-admin) = a
    // real provisioning problem → reason-aware welcome.
    if (!status || status >= 500) {
      console.warn('[workforce] backend unreachable', err);
      throw error(status && status >= 500 ? status : 502, 'Workforce backend unavailable');
    }
    console.warn('[workforce] provisioning failed', err);
    throw redirect(302, '/workforce/welcome?reason=provision-failed');
  }

  // Make the id visible to child +page.server.ts loads this request.
  if (event.locals.workforceIdentity) {
    event.locals.workforceIdentity.companyId = orgId;
  }

  return { companyId: orgId };
};
