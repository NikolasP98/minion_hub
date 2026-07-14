import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { gatewayCall } from '$lib/server/gateway-rpc';
import { getFleetUpdateAvailability } from '$server/services/fleet-update.service';

// Gateway self-update is a platform-level operation (not org-scoped), so it
// gates on the `admin` role directly — same pattern as the other
// system/server-level routes (e.g. api/servers/[id]/provision/status,run) —
// rather than the org-capability RBAC map (`/api/gateway` isn't in
// apiWriteCapability's prefix list, and there's no "update" RBAC module).

// update.run holds the RPC open through the npm install (40-120s in prod) —
// keep the serverless function alive for the whole window (Vercel).
export const config = { maxDuration: 300 };

export const GET: RequestHandler = async ({ locals }) => {
  requireAdmin(locals);
  const fleet = await getFleetUpdateAvailability();
  if (fleet) return json(fleet);
  const status = await gatewayCall('update.status', {});
  return json({ ...(status as Record<string, unknown>), updateSource: 'package', targetSource: 'package' });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const body = (await request.json().catch(() => ({}))) as { action?: string };
  if (body.action === 'check') {
    const fleet = await getFleetUpdateAvailability(true);
    if (fleet) return json(fleet);
    const status = await gatewayCall('update.check', {});
    return json({ ...(status as Record<string, unknown>), updateSource: 'package', targetSource: 'package' });
  }
  if (body.action === 'run') {
    // The gateway answers update.run only after the npm install completes,
    // and it drops the WS when it restarts — so a timeout/close AFTER the run
    // was dispatched is the install proceeding, NOT a failure. Only an
    // explicit error response from update.run should read as failed.
    // 290s < maxDuration so we always answer before the platform kills us.
    try {
      return json(await gatewayCall('update.run', {}, { timeoutMs: 290_000 }));
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      if (msg.includes('(request sent)')) return json({ ok: true, accepted: true });
      throw err;
    }
  }
  throw error(400, 'action must be "check" or "run"');
};
