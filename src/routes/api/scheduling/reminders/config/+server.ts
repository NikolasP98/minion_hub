import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAdmin } from '$server/auth/authorize';
import { isModuleEnabled } from '$server/services/modules.service';
import { getReminderConfig, saveReminderConfig } from '$server/services/reminder-config.service';
import type { ReminderStage, ReminderChannel } from '$server/db/pg-reminders-schema';

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
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
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
