import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { syncContactsFromLedger } from '$server/services/crm-contacts.service';

/** POST /api/crm/contacts/sync — "Sync now": harvest new inbound senders from the
 *  ledger into contacts. Idempotent set-based anti-join; safe to call anytime. */
export const POST: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const result = await syncContactsFromLedger(ctx);
  return json(result);
};
