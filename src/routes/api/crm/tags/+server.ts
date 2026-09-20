import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { listTags, createTag } from '$server/services/crm-contacts.service';
import { isTagScope } from '$lib/tags/scope';

/** GET /api/crm/tags[?scope=crm|stock|catalog|event] — tag definitions for the org (all scopes by default). */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const scope = url.searchParams.get('scope');
  return json({ tags: await listTags(ctx, isTagScope(scope) ? scope : undefined) });
};

const postSchema = z.object({
  name: z.string().min(1).max(500),
  color: z.string().max(50).nullable().optional(),
  kind: z.enum(['manual', 'auto', 'ai']).optional(),
  description: z.unknown().optional(),
  rule: z.unknown().optional(),
  scope: z.enum(['crm', 'stock', 'catalog', 'event']).optional(),
});

/** POST /api/crm/tags — create a manual, auto, or ai tag. */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, postSchema);
  const kind = body.kind === 'auto' || body.kind === 'ai' ? body.kind : 'manual';
  // AI tags carry their qualification criteria as { description } in `rule`.
  const rule = kind === 'ai' ? { description: String(body.description ?? '').trim() } : body.rule;
  try {
    const tag = await createTag(
      ctx,
      { name: body.name.trim(), color: body.color ?? null, kind, rule, scope: body.scope },
      locals.user?.supabaseId ?? null,
    );
    return json({ tag }, { status: 201 });
  } catch (e) {
    throw error(400, e instanceof Error ? e.message : 'Invalid tag');
  }
};
