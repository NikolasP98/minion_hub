import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability, shouldMaskSensitive } from '$server/services/rbac.service';
import { parseBody } from '$server/api/validate';
import { uuidParamOr404 } from '$server/utils/uuid-param';
import { getDoor } from '$server/services/doors.service';
import { getChannelCatalog } from '$server/services/crm-channels.service';
import {
  followUpSchema,
  getFollowUpActivity,
  setFollowUp,
} from '$server/services/doors-followup.service';
import { maskPii } from '$lib/pii';

/**
 * GET/PUT /api/crm/doors/[id]/follow-up (spec 041 S4). Both need `crm:manage`:
 * the activity rows say who submitted the form, and form submissions are
 * readable by owner/admin only (owner decision).
 */

/** GET → `{ followUp, accounts, counts, rows }`. `accounts` is null when the gateway is unreachable. */
export const GET: RequestHandler = async ({ locals, params }) => {
  const id = uuidParamOr404(params.id!);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  await requireOrgCapability(locals, 'crm', 'manage');
  const door = await getDoor(ctx, id);
  if (!door || door.kind !== 'form') throw error(404, 'Not found');
  const [catalog, activity, mask] = await Promise.all([
    getChannelCatalog(ctx),
    getFollowUpActivity(ctx, id),
    shouldMaskSensitive(locals, 'crm'),
  ]);
  return json({
    followUp: door.followUp ?? null,
    accounts:
      catalog?.accounts
        .filter((a) => a.channel === 'whatsapp')
        .map((a) => ({ accountId: a.accountId, name: a.name, phone: a.phone })) ?? null,
    counts: activity.counts,
    rows: mask
      ? activity.rows.map((r) => ({ ...r, recipient: r.recipient ? maskPii(r.recipient) : null }))
      : activity.rows,
  });
};

/** PUT body `FollowUp`. Enabling needs an account from this org's live catalog. */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
  const id = uuidParamOr404(params.id!);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  await requireOrgCapability(locals, 'crm', 'manage');
  const followUp = await parseBody(request, followUpSchema);
  const door = await getDoor(ctx, id);
  if (!door) throw error(404, 'Not found');
  if (door.kind !== 'form') return json({ error: 'not_form' }, { status: 400 });
  // Turning it off never depends on the gateway.
  if (followUp.enabled) {
    const catalog = await getChannelCatalog(ctx);
    if (!catalog) return json({ error: 'gateway_unavailable' }, { status: 503 });
    const ok = catalog.accounts.some(
      (a) => a.channel === 'whatsapp' && a.accountId === followUp.accountId,
    );
    if (!ok) return json({ error: 'account_not_available' }, { status: 400 });
  }
  const stored = await setFollowUp(ctx, id, followUp);
  if (!stored) throw error(404, 'Not found');
  return json({ followUp: stored });
};
