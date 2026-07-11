import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAdmin, requireTenantCtx } from '$server/auth/authorize';
import {
  startFleetUpdate,
  advanceFleetUpdate,
  getFleetUpdateStatus,
  abortFleetUpdate,
} from '$server/services/fleet-update.service';

// Fleet update is a platform-level operation — admin-gated the same way as
// /api/gateway/update, not the org-capability RBAC map.

// advance() drives one instance's drain+run+poll-verify cycle, which can
// alone take up to ~243s — keep the function alive for the whole window.
export const config = { maxDuration: 300 };

export const POST: RequestHandler = async ({ locals, request }) => {
  const user = requireAdmin(locals);
  const { tenantId } = requireTenantCtx(locals);
  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    targetVersion?: string;
  };

  try {
    switch (body.action) {
      case 'start': {
        if (!body.targetVersion) throw error(400, 'targetVersion is required');
        return json(await startFleetUpdate(tenantId, user.id, body.targetVersion));
      }
      case 'advance': {
        const view = await advanceFleetUpdate(tenantId);
        if (!view) throw error(404, 'No fleet update job found');
        return json(view);
      }
      case 'status': {
        const view = await getFleetUpdateStatus(tenantId);
        return json(view ?? { active: false });
      }
      case 'abort': {
        const view = await abortFleetUpdate(tenantId);
        if (!view) throw error(404, 'No active fleet update job');
        return json(view);
      }
      default:
        throw error(400, 'action must be "start", "advance", "status", or "abort"');
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'A fleet update is already in progress') {
      throw error(409, err.message);
    }
    throw err;
  }
};
