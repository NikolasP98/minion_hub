import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { parseBody } from '$server/api/validate';
import { getSettings, saveSettings } from '$server/services/pulse.service';

// auto_approve is scaffold-only in slice 1 (graduation ramp is slice 2) — not accepted here.
const patchSchema = z.object({
  enabled: z.boolean().optional(),
  briefingTime: z.string().optional(),
  locale: z.string().optional(),
  channels: z.array(z.string()).optional(),
  watch: z.object({ email: z.boolean(), whatsapp: z.boolean(), calendar: z.boolean() }).optional(),
});

/** GET /api/pulse/settings — the caller org's Pulse settings row. */
export const GET: RequestHandler = async ({ locals }) => {
  await requireOrgCapability(locals, 'pulse', 'view');
  const ctx = await requireCoreCtx(locals);
  return json(await getSettings(ctx));
};

/** POST /api/pulse/settings — patch Pulse settings (enable, briefing time, locale, channels, watch). */
export const POST: RequestHandler = async ({ locals, request }) => {
  await requireOrgCapability(locals, 'pulse', 'edit');
  const ctx = await requireCoreCtx(locals);
  const patch = await parseBody(request, patchSchema);
  await saveSettings(ctx, patch);
  return json({ ok: true });
};
