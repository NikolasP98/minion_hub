import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { getCoreDb } from '$server/db/pg-client';
import type { CoreCtx } from '$server/auth/core-ctx';
import { upsertProposals } from '$server/services/pulse.service';
import {
  legacyOrgId,
  PulseIngestError,
  readPulseRequestObject,
  validatePulseProposals,
} from '$server/services/pulse-ingest-contract';

/**
 * POST /api/gateway/pulse/proposals  (gateway server-token channel)
 *   body: { proposals: ProposalInput[], orgId?: string }
 *
 * The authenticated machine credential is the only tenant authority. orgId is
 * accepted temporarily for exact same-tenant legacy callers.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  // NOTE: requires '/api/gateway/pulse/proposals' in isServerTokenPath
  // (resolve-identity.ts) or this always 401s.
  const canonicalOrgId = locals.tenantCtx?.tenantId;
  if (!locals.serverId?.trim() || !canonicalOrgId?.trim()) {
    return json({ ok: false, error: 'machine_identity_required' }, { status: 401 });
  }

  try {
    const body = await readPulseRequestObject(request);
    const suppliedOrgId = legacyOrgId(body);
    if (suppliedOrgId !== undefined && suppliedOrgId !== canonicalOrgId) {
      return json({ ok: false, error: 'tenant_mismatch' }, { status: 403 });
    }
    const proposals = validatePulseProposals(body);
    const ctx: CoreCtx = { db: getCoreDb(), tenantId: canonicalOrgId };
    const res = await upsertProposals(ctx, proposals);
    return json({ ok: true, ...res }, { status: 201 });
  } catch (caught) {
    if (caught instanceof PulseIngestError) {
      return json({ ok: false, error: caught.code }, { status: caught.status });
    }
    console.error('[pulse-ingest]', { errorClass: 'storage_failed' });
    return json({ ok: false, error: 'storage_failed' }, { status: 500 });
  }
};
