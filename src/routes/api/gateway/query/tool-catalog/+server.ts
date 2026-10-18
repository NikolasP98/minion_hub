import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { resolveAssistantPrincipal } from '$server/auth/assistant-principal';
import { getCoreDb } from '$server/db/pg-client';
import { listModuleStates } from '$server/services/modules.service';
import { assistantToolCatalog } from '$server/services/assistant-tool-catalog';

export const GET: RequestHandler = async ({ locals, url }) => {
  const principal = await resolveAssistantPrincipal(locals, url);
  const moduleStates = await listModuleStates({
    db: getCoreDb(),
    tenantId: principal.orgId,
    profileId: principal.principalId,
  });
  return json(assistantToolCatalog(principal, moduleStates), {
    headers: { 'cache-control': 'private, no-store' },
  });
};
