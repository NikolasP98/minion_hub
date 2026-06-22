import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAdmin } from '$server/auth/authorize';
import { isModuleEnabled } from '$server/services/modules.service';
import { composeReminder, sampleContext } from '$server/services/reminder-compose';

/**
 * Compose a SAMPLE personalized notification for the settings preview. Each call
 * re-runs the LLM (temperature > 0), so the UI's "regenerate" button surfaces a
 * fresh iteration. Uses placeholder appointment data — never touches a booking.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const personalize = b.personalize !== false;
  const text = await composeReminder(
    sampleContext({
      stage: b.stage ? String(b.stage) : 'confirmation',
      fromName: b.fromName ? String(b.fromName) : null,
      locale: b.locale ? String(b.locale) : 'es',
    }),
    personalize,
  );
  return json({ text });
};
