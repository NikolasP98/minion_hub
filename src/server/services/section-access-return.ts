import type { RequestEvent } from '@sveltejs/kit';
import { getCoreDb } from '$server/db/pg-client';
import { readNavConfig } from './nav-config.service';
import { resolveFreshCapabilitiesInTransaction } from './rbac.service';
import { loadUserPreferences } from './preferences.service';
import { listModuleStates } from './modules.service';
import { simulationDestination } from './simulation-navigation';

/** Navigation is evaluated after a committed policy write against fresh capability rows. */
export async function resolvePolicyReturnLocation(event: RequestEvent): Promise<string> {
  const orgId = event.locals.tenantCtx?.tenantId;
  const profileId = event.locals.user?.supabaseId;
  if (!orgId || !profileId) return '/account/home';
  const referrer = event.request.headers.get('referer');
  let current = '/account/home';
  if (referrer) {
    const url = new URL(referrer);
    if (url.origin === event.url.origin) current = url.pathname + url.search;
  }
  const [nav, capabilities, preference, moduleStates] = await Promise.all([
    readNavConfig({ db: getCoreDb(), tenantId: orgId, profileId }),
    getCoreDb().transaction(
      async (tx) =>
        (await resolveFreshCapabilitiesInTransaction(tx, orgId, profileId)).capabilities,
    ),
    loadUserPreferences(event.locals, profileId),
    listModuleStates({ db: getCoreDb(), tenantId: orgId, profileId }),
  ]);
  return simulationDestination({
    current,
    orgId,
    preferences: preference.preferences,
    ctx: {
      nav,
      capabilities,
      platformRole: event.locals.user?.role,
      availability: { kind: event.locals.orgKind, moduleStates },
    },
  });
}
