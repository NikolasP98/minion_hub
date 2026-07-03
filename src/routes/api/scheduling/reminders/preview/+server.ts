import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAdmin } from '$server/auth/authorize';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { composeReminder, sampleContext } from '$server/services/reminder-compose';

const previewSchema = z.object({
  personalize: z.boolean().optional(),
  stage: z.string().max(100).optional(),
  fromName: z.string().max(200).nullable().optional(),
  locale: z.string().max(20).optional(),
});

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
  const b = await parseBody(request, previewSchema);
  const personalize = b.personalize !== false;
  const text = await composeReminder(
    sampleContext({
      stage: b.stage ?? 'confirmation',
      fromName: b.fromName ?? null,
      locale: b.locale ?? 'es',
    }),
    personalize,
  );
  return json({ text });
};
