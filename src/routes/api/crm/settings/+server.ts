import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { parseBody } from '$server/api/validate';
import { depositWriteSchema } from '$server/services/crm-deposit-rule';
import { resolveDepositRule, writeDepositRule } from '$server/services/crm-settings.service';

/**
 * `/api/crm/settings` — S3 of 2026-08-17-hub-reserva-keyword-config-spec.
 * Write gate: `apiWriteCapability` (hooks.server.ts) maps the `/api/crm`
 * prefix to `crm:edit` centrally — no per-route capability check needed,
 * same convention as the other `src/routes/api/crm/*` routes. Reads are NOT
 * covered by that central hook (GET/HEAD are excluded), so this GET gates
 * itself explicitly on `crm:view`.
 */

/** GET /api/crm/settings — the org's resolved deposit rule (default if unset). */
export const GET: RequestHandler = async ({ locals }) => {
  await requireOrgCapability(locals, 'crm', 'view');
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

/**
 * PUT /api/crm/settings — replace the org's deposit rule.
 *
 * Responds with the SAME `deposit` key the GET (and the request body) uses, so
 * a client never has to know two names for one thing, plus the ⚠️ A3 staleness
 * disclosure: `crm_win_embeddings.bought`/`snippet` rows built under the
 * previous rule are NOT rebuilt by this write, and `staleDerivedCount` is how
 * many of them the caller now has.
 */
export const PUT: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, putSchema);
  const { rule, staleDerived, staleDerivedCount } = await writeDepositRule(ctx, body.deposit);
  return json({ deposit: rule, staleDerived, staleDerivedCount });
};
