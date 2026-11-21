import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { hasPasswordIdentity } from '$server/auth/password';
import { listConnections } from '$server/mcp/oauth.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  depends('app:security');
  if (!locals.tenantCtx || !locals.user) throw error(401, 'authentication required');

  const supabaseId = locals.user.supabaseId ?? locals.user.id;

  return {
    username: locals.user.username ?? null,
    email: locals.user.email,
    hasPassword: await hasPasswordIdentity(supabaseId),
    // The person's own MCP connections in the active organization (spec 143 US3.1).
    connections: await listConnections(locals.tenantCtx.tenantId, supabaseId, false),
  };
};
