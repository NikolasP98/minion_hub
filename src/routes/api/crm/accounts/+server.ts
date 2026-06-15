import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listCrmAccounts, setAccountEnabled } from '$server/services/crm-contacts.service';

/** GET /api/crm/accounts — connected channel accounts with counts + enabled state. */
export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  return json({ accounts: await listCrmAccounts(ctx) });
};

/** PATCH /api/crm/accounts — enable/disable one (channel, accountId) for harvesting. */
export const PATCH: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await request.json().catch(() => ({}));
  if (!body.channel || typeof body.channel !== 'string') throw error(400, 'channel is required');
  if (typeof body.accountId !== 'string') throw error(400, 'accountId is required');
  if (typeof body.enabled !== 'boolean') throw error(400, 'enabled must be a boolean');
  const settings = await setAccountEnabled(ctx, body.channel.trim(), body.accountId, body.enabled);
  return json({ settings });
};
