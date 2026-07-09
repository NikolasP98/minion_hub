import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreDb } from '$server/db/pg-client';
import { supabaseAdmin } from '$server/supabase';
import { recordEntry } from '$server/services/email-ledger.service';
import type { CoreCtx } from '$server/auth/core-ctx';

/**
 * POST /api/gateway/email-ledger  (gateway server-token channel)
 *   body: { mailbox, gmailMessageId, fromDomain?, subject?, summary?, labels? }
 *
 * Records one PROCESSED email to the org's ledger. The gateway watcher only
 * knows the mailbox address, so we attribute the row here: mailbox → the owning
 * Google identity (user_identities.external_id) → that user's org. Content is
 * never sent (see the gateway sink); this stores summary + labels + metadata.
 *
 * Gateway-only (locals.serverId). Unknown mailboxes are acked (200) so the
 * watcher doesn't retry a mailbox nobody has linked.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.serverId) throw error(401, 'gateway server token required');

  const body = (await request.json().catch(() => ({}))) as {
    mailbox?: unknown;
    gmailMessageId?: unknown;
    fromDomain?: unknown;
    subject?: unknown;
    summary?: unknown;
    labels?: unknown;
  };
  const mailbox = typeof body.mailbox === 'string' ? body.mailbox.trim().toLowerCase() : '';
  const gmailMessageId = typeof body.gmailMessageId === 'string' ? body.gmailMessageId : '';
  if (!mailbox || !gmailMessageId) {
    throw error(400, 'mailbox and gmailMessageId are required');
  }

  // mailbox → owning user → org. supabaseAdmin bypasses RLS (service role).
  const admin = supabaseAdmin();
  const { data: idRow } = await admin
    .from('user_identities')
    .select('user_id')
    .eq('provider', 'google')
    .eq('external_id', mailbox)
    .maybeSingle();
  const userId = (idRow as { user_id?: string } | null)?.user_id;
  if (!userId) {
    return json({ ok: false, reason: 'mailbox not linked' }, { status: 200 });
  }
  const { data: memberRow } = await admin
    .from('organization_members')
    .select('organization_id')
    .eq('profile_id', userId)
    .limit(1)
    .maybeSingle();
  const orgId = (memberRow as { organization_id?: string } | null)?.organization_id;
  if (!orgId) {
    return json({ ok: false, reason: 'no org for mailbox owner' }, { status: 200 });
  }

  const ctx: CoreCtx = { db: getCoreDb(), tenantId: orgId, profileId: userId };
  const labels = Array.isArray(body.labels)
    ? body.labels.filter((l): l is string => typeof l === 'string')
    : [];
  try {
    await recordEntry(ctx, {
      userId,
      mailbox,
      gmailMessageId,
      fromDomain: typeof body.fromDomain === 'string' ? body.fromDomain : null,
      subject: typeof body.subject === 'string' ? body.subject : null,
      summary: typeof body.summary === 'string' ? body.summary : null,
      labels,
    });
    return json({ ok: true }, { status: 201 });
  } catch (e) {
    console.error('[POST /api/gateway/email-ledger]', e);
    return json({ error: e instanceof Error ? e.message : 'ledger write failed' }, { status: 500 });
  }
};
