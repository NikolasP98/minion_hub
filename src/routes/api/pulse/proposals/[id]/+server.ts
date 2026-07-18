import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { requireAuth } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { parseBody } from '$server/api/validate';
import { gatewayCallAsUser } from '$lib/server/gateway-rpc';
import { getProposal, markApproved, dismiss, editPayload } from '$server/services/pulse.service';

/** Kinds that execute immediately on approve via a one-shot gateway agentTurn.
 *  Everything else (digest, fyi, draft_reply) is just marked approved — no
 *  gateway call, the card was informational or the user will act manually. */
const EXECUTE_KINDS = new Set(['create_event', 'reminder']);

const postSchema = z.object({ action: z.enum(['approve', 'dismiss']) });
const patchSchema = z.object({ args: z.record(z.string(), z.unknown()) });

/** POST /api/pulse/proposals/[id] — approve or dismiss a Pulse card.
 *  Approving a create_event/reminder card fires a one-shot gateway agentTurn
 *  (via cron.add, deleteAfterRun) to execute it in the user's session. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  const user = requireAuth(locals);
  await requireOrgCapability(locals, 'pulse', 'edit');
  const ctx = await requireCoreCtx(locals);
  const { action } = await parseBody(request, postSchema);

  const id = params.id;
  const proposal = await getProposal(ctx, id);
  if (!proposal) throw error(404, 'proposal not found');
  if (proposal.status !== 'pending') {
    return json({ ok: false, status: proposal.status, reason: 'already decided' }, { status: 409 });
  }

  const by = ctx.profileId ?? user.id;

  if (action === 'dismiss') {
    await dismiss(ctx, id, by);
    return json({ ok: true, status: 'dismissed' });
  }

  // approve
  if (EXECUTE_KINDS.has(proposal.kind)) {
    const instruction =
      proposal.kind === 'create_event'
        ? `Execute now, without asking: call calendar_create_event with these args: ${JSON.stringify(proposal.payload.args)}. Then confirm in one short line.`
        : `Execute now, without asking: set a reminder using your cron tool for: ${JSON.stringify(proposal.payload.args)}. Then confirm in one short line.`;
    // ponytail: async receipt via WhatsApp confirm — a sync executed-status write is
    // slice 2 (needs the agent to call back). Fire-and-forget; the agent's one-line
    // confirmation is the receipt.
    await gatewayCallAsUser(
      'cron.add',
      {
        job: {
          name: `pulse-exec-${proposal.id}`,
          enabled: true,
          scope: 'session',
          sessionTarget: 'isolated',
          wakeMode: 'next-heartbeat',
          schedule: { kind: 'at', at: new Date(Date.now() + 5000).toISOString() },
          deleteAfterRun: true,
          payload: { kind: 'agentTurn', message: instruction },
          delivery: { mode: 'announce', channel: 'whatsapp' },
        },
      },
      ctx.profileId,
      { orgId: ctx.tenantId },
    );
  }
  await markApproved(ctx, id, by);
  return json({ ok: true, status: 'approved' });
};

/** PATCH /api/pulse/proposals/[id] — edit a card's payload args before approving. */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  await requireOrgCapability(locals, 'pulse', 'edit');
  const ctx = await requireCoreCtx(locals);
  const { args } = await parseBody(request, patchSchema);
  await editPayload(ctx, params.id, args);
  return json({ ok: true });
};
