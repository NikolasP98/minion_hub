import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { depositWriteSchema } from '$server/services/crm-deposit-rule';
import { resolveDepositRule, writeDepositRule } from '$server/services/crm-settings.service';

/**
 * `/api/crm/settings` — S3 of 2026-08-17-hub-reserva-keyword-config-spec.
 * Write gate: `apiWriteCapability` (hooks.server.ts) maps the `/api/crm`
 * prefix to `crm:edit` centrally — no per-route capability check needed,
 * same convention as the other `src/routes/api/crm/*` routes.
 */

/** GET /api/crm/settings — the org's resolved deposit rule (default if unset). */
export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  return json({ deposit: await resolveDepositRule(ctx) });
};

// The client's request contract only ever touches `deposit` — `updatedAt` is
// stamped server-side (depositWriteSchema.strict() already rejects it), and
// this endpoint never accepts/replaces the whole `crm_settings.value`
// document, so sibling keys (`accounts`, `disabled_channels`, …) are safe by
// construction: writeDepositRule only ever merges the `deposit` key.
const putSchema = z.object({ deposit: depositWriteSchema });

/** PUT /api/crm/settings — replace the org's deposit rule. */
export const PUT: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, putSchema);
  const result = await writeDepositRule(ctx, body.deposit);
  return json(result);
};
