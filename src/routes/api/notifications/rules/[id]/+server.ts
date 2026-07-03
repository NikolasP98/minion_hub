import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { requireAdmin } from '$server/auth/authorize';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { updateRule, deleteRule } from '$server/services/notif.service';

// condition/recipients are loose JSON blobs — kept as z.unknown() per plan;
// updateRule re-validates triggerTable/dateField against its own allowlist.
const patchSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  enabled: z.boolean().optional(),
  triggerTable: z.string().min(1).max(200).optional(),
  triggerEvent: z.enum(['insert', 'update', 'date_offset']).optional(),
  dateField: z.string().max(200).nullable().optional(),
  dateOffsetMins: z.coerce.number().int().nullable().optional(),
  condition: z.array(z.unknown()).optional(),
  recipients: z.array(z.unknown()).optional(),
  channel: z.enum(['whatsapp', 'telegram', 'email']).optional(),
  accountId: z.string().max(200).nullable().optional(),
  template: z.string().min(1).max(20_000).optional(),
});

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, patchSchema);
  const rule = await updateRule(ctx, params.id!, body);
  if (!rule) throw error(404);
  return json(rule);
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  await deleteRule(ctx, params.id!);
  return json({ ok: true });
};
