import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$server/auth/authorize';
import { provisionOrganization } from '$server/services/organization-provision.service';

export const POST: RequestHandler = async (event) => {
  const user = requireAdmin(event.locals);
  if (!user.supabaseId) throw error(409, 'A Supabase profile is required to own the organization');

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }

  let result;
  try {
    result = await provisionOrganization(event, {
      name: (body as { name?: unknown })?.name as string,
      profileId: user.supabaseId,
      existingWorkforceCompanyId: (body as { existingWorkforceCompanyId?: unknown })
        ?.existingWorkforceCompanyId as string | undefined,
    });
  } catch (cause) {
    throw error(400, cause instanceof Error ? cause.message : 'Invalid organization request');
  }
  return json(result, { status: result.ok ? 200 : 502 });
};
