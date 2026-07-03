import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAdmin } from '$server/auth/authorize';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { getReminderConfig, saveReminderConfig } from '$server/services/reminder-config.service';
import type { ReminderStage, ReminderChannel } from '$server/db/pg-reminders-schema';

// stages/channels are loose JSON blobs — kept as z.unknown() per plan (no deep
// structural schema in this pass); per-item shape is validated below as before.
const putSchema = z.object({
  enabled: z.boolean().optional(),
  stages: z.array(z.unknown()).optional(),
  channels: z.array(z.unknown()).optional(),
  channel: z.string().max(100).optional(),
  accountId: z.string().max(200).nullable().optional(),
  personalize: z.boolean().optional(),
  inferConfirmation: z.boolean().optional(),
  locale: z.string().max(20).optional(),
  fromName: z.string().max(200).nullable().optional(),
});

export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  return json({ config: await getReminderConfig(ctx) });
};

export const PUT: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  const b = await parseBody(request, putSchema);
  const stages = Array.isArray(b.stages)
    ? (b.stages as Array<Record<string, unknown>>).map((s) => ({
        key: String(s.key),
        ...(s.minutesBefore != null ? { minutesBefore: Number(s.minutesBefore) } : {}),
        ...(s.enabled !== undefined ? { enabled: s.enabled === true } : {}),
        ...(s.recipients ? { recipients: String(s.recipients) as ReminderStage['recipients'] } : {}),
      }) as ReminderStage)
    : undefined;
  const channels = Array.isArray(b.channels)
    ? (b.channels as Array<Record<string, unknown>>)
        .filter((c) => c && c.channel)
        .map((c) => ({ channel: String(c.channel), accountId: c.accountId ? String(c.accountId) : null }) as ReminderChannel)
    : undefined;
  await saveReminderConfig(ctx, {
    ...(b.enabled !== undefined ? { enabled: b.enabled === true } : {}),
    ...(stages ? { stages } : {}),
    ...(channels ? { channels } : {}),
    ...(b.channel !== undefined ? { channel: String(b.channel) } : {}),
    ...(b.accountId !== undefined ? { accountId: b.accountId ? String(b.accountId) : null } : {}),
    ...(b.personalize !== undefined ? { personalize: b.personalize === true } : {}),
    ...(b.inferConfirmation !== undefined ? { inferConfirmation: b.inferConfirmation === true } : {}),
    ...(b.locale !== undefined ? { locale: String(b.locale) } : {}),
    ...(b.fromName !== undefined ? { fromName: b.fromName ? String(b.fromName) : null } : {}),
  });
  return json({ ok: true });
};
