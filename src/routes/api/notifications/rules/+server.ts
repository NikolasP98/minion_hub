import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { requireAdmin } from '$server/auth/authorize';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { listRules, createRule } from '$server/services/notif.service';

// condition/recipients are loose JSON blobs — kept as z.unknown() per plan;
// createRule re-validates triggerTable/dateField against its own allowlist.
const ruleSchema = z.object({
  name: z.string().min(1).max(500),
  enabled: z.boolean().optional(),
  triggerTable: z.string().min(1).max(200),
  triggerEvent: z.enum(['insert', 'update', 'date_offset']),
  dateField: z.string().max(200).nullable().optional(),
  dateOffsetMins: z.coerce.number().int().nullable().optional(),
  condition: z.array(z.unknown()).optional(),
  recipients: z.array(z.unknown()).optional(),
  channel: z.enum(['whatsapp', 'telegram', 'email']),
  accountId: z.string().max(200).nullable().optional(),
  template: z.string().min(1).max(20_000),
});

export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  return json(await listRules(ctx));
};

export const POST: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const b = await parseBody(request, ruleSchema);
  try {
    const rule = await createRule(ctx, b);
    return json(rule, { status: 201 });
  } catch (e) {
    throw error(400, e instanceof Error ? e.message : 'invalid rule');
  }
};
