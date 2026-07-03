import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import {
  addCrmAccount,
  removeCrmAccount,
  updateCrmAccount,
} from '$server/services/crm-contacts.service';
import { getAccountScopeLive } from '$server/services/crm-channels.service';

/** GET /api/crm/accounts — added accounts (with config) + available-to-add. */
export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  return json({ scope: await getAccountScopeLive(ctx) });
};

const postSchema = z.object({
  channel: z.string().min(1).max(200),
  accountId: z.string().max(200),
});

/** POST /api/crm/accounts — add a linked account to the CRM scope. */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, postSchema);
  await addCrmAccount(ctx, body.channel.trim(), body.accountId);
  return json({ scope: await getAccountScopeLive(ctx) }, { status: 201 });
};

const patchSchema = z.object({
  channel: z.string().min(1).max(200),
  accountId: z.string().max(200),
  label: z.string().max(500).nullable().optional(),
  paused: z.boolean().optional(),
});

/** PATCH /api/crm/accounts — rename or pause/resume a scoped account. */
export const PATCH: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, patchSchema);
  const patch: { label?: string | null; paused?: boolean } = {};
  if ('label' in body) patch.label = body.label === null ? null : String(body.label).trim() || null;
  if ('paused' in body) patch.paused = body.paused;
  await updateCrmAccount(ctx, body.channel.trim(), body.accountId, patch);
  return json({ scope: await getAccountScopeLive(ctx) });
};

/** DELETE /api/crm/accounts?channel=&accountId= — remove from the CRM scope. */
export const DELETE: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const channel = url.searchParams.get('channel');
  const accountId = url.searchParams.get('accountId');
  if (!channel) throw error(400, 'channel is required');
  if (accountId === null) throw error(400, 'accountId is required');
  await removeCrmAccount(ctx, channel.trim(), accountId);
  return json({ scope: await getAccountScopeLive(ctx) });
};
