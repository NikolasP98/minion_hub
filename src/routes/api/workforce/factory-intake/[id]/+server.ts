import { error, json } from '@sveltejs/kit';
import { workforceRawFetch } from '$lib/server/workforce-fetch';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  if (!event.locals.user) throw error(401, 'Authentication required');
  if (!event.locals.workforceIdentity) {
    return json(
      { error: 'The factory control plane is unavailable.', code: 'workforce_unavailable' },
      { status: 503 },
    );
  }
  const companyId = event.locals.orgId ?? event.locals.tenantCtx?.tenantId ?? null;
  if (!companyId) throw error(409, 'Select an organization to inspect factory work.');

  try {
    const result = await workforceRawFetch<unknown>(
      event,
      `/api/factory-intakes/${encodeURIComponent(event.params.id)}`,
    );
    return json(result);
  } catch (cause) {
    console.warn('[factory-intake] Workforce status request failed', cause);
    const status = (cause as { status?: number })?.status;
    return json(
      { error: 'Factory intake status is temporarily unavailable.', code: 'workforce_unavailable' },
      { status: status && status >= 400 && status < 500 ? status : 502 },
    );
  }
};
