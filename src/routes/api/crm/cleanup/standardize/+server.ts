import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { scanStandardization, applyStandardization } from '$server/services/crm-cleanup.service';

/** GET /api/crm/cleanup/standardize — deterministic name-fix proposals. */
export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  return json({ fixes: await scanStandardization(ctx) });
};

/** POST /api/crm/cleanup/standardize { fixes: [{contactId, name, before?}] } — apply. */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await request.json().catch(() => ({}));
  const fixes = Array.isArray(body.fixes) ? body.fixes : [];
  const valid = fixes
    .filter(
      (f: unknown): f is { contactId: string; name: string; before?: string | null } =>
        !!f && typeof (f as { contactId?: unknown }).contactId === 'string' && typeof (f as { name?: unknown }).name === 'string',
    )
    .map((f: { contactId: string; name: string; before?: unknown }) => ({
      contactId: f.contactId,
      name: f.name,
      before: typeof f.before === 'string' ? f.before : null,
    }));
  return json({ updated: await applyStandardization(ctx, valid) });
};
