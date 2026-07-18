import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreDb } from '$server/db/pg-client';
import type { CoreCtx } from '$server/auth/core-ctx';
import { upsertProposals, type ProposalInput } from '$server/services/pulse.service';

/**
 * POST /api/gateway/pulse/proposals  (gateway server-token channel)
 *   body: { orgId, proposals: ProposalInput[] }
 *
 * The gateway pushes explicit orgId, so no mailbox→org lookup is needed here
 * (contrast with email-ledger). Gateway-only (locals.serverId).
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  // NOTE: requires '/api/gateway/pulse/proposals' in isServerTokenPath
  // (resolve-identity.ts) or this always 401s.
  if (!locals.serverId) throw error(401, 'gateway server token required');
  const body = (await request.json().catch(() => ({}))) as { orgId?: unknown; proposals?: unknown };
  const orgId = typeof body.orgId === 'string' ? body.orgId : '';
  const proposals = Array.isArray(body.proposals) ? (body.proposals as ProposalInput[]) : null;
  if (!orgId || !proposals) throw error(400, 'orgId and proposals[] are required');

  // Minimal validation: each card needs source, kind, title, dedupKey.
  const clean = proposals.filter((p) => p && p.source && p.kind && p.title && p.dedupKey);
  const ctx: CoreCtx = { db: getCoreDb(), tenantId: orgId };
  try {
    const res = await upsertProposals(ctx, clean);
    return json({ ok: true, ...res }, { status: 201 });
  } catch (e) {
    console.error('[POST /api/gateway/pulse/proposals]', e);
    return json({ error: e instanceof Error ? e.message : 'pulse ingest failed' }, { status: 500 });
  }
};
