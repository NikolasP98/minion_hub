import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  readOrganizationMutationBody,
  saveOrganizationBranding,
} from '$server/services/organization-branding.service';
export const PATCH: RequestHandler = async ({ locals, request }) => {
  if (!locals.user?.supabaseId || !locals.tenantCtx) throw error(401);
  const body = await readOrganizationMutationBody(request);
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !('hubName' in body) ||
    (body.hubName !== null && typeof body.hubName !== 'string')
  )
    throw error(400, 'Invalid branding fields');
  const result = await saveOrganizationBranding(locals, body.hubName as string | null);
  return json(result, { headers: { 'Cache-Control': 'private, no-store' } });
};
