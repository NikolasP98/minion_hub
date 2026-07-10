import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { gatewayCall } from '$lib/server/gateway-rpc';

// Gateway self-update is a platform-level operation (not org-scoped), so it
// gates on the `admin` role directly — same pattern as the other
// system/server-level routes (e.g. api/servers/[id]/provision/status,run) —
// rather than the org-capability RBAC map (`/api/gateway` isn't in
// apiWriteCapability's prefix list, and there's no "update" RBAC module).

export const GET: RequestHandler = async ({ locals }) => {
  requireAdmin(locals);
  const status = await gatewayCall('update.status', {});
  return json(status);
};

export const POST: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const body = (await request.json().catch(() => ({}))) as { action?: string };
  if (body.action === 'check') {
    return json(await gatewayCall('update.check', {}));
  }
  if (body.action === 'run') {
    return json(await gatewayCall('update.run', {}));
  }
  throw error(400, 'action must be "check" or "run"');
};
