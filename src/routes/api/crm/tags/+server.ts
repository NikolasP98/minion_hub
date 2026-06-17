import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listTags, createTag } from '$server/services/crm-contacts.service';

/** GET /api/crm/tags — all tag definitions for the org. */
export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  return json({ tags: await listTags(ctx) });
};

/** POST /api/crm/tags — create a manual, auto, or ai tag. */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await request.json().catch(() => ({}));
  if (!body.name || typeof body.name !== 'string') throw error(400, 'name is required');
  const kind = body.kind === 'auto' || body.kind === 'ai' ? body.kind : 'manual';
  // AI tags carry their qualification criteria as { description } in `rule`.
  const rule = kind === 'ai' ? { description: String(body.description ?? '').trim() } : body.rule;
  try {
    const tag = await createTag(
      ctx,
      { name: body.name.trim(), color: body.color ?? null, kind, rule },
      locals.user?.supabaseId ?? null,
    );
    return json({ tag }, { status: 201 });
  } catch (e) {
    throw error(400, e instanceof Error ? e.message : 'Invalid tag');
  }
};
