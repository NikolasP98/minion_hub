import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { requireOrgCapability } from '$server/services/rbac.service';
import { isModuleEnabled } from '$server/services/modules.service';
import { listTags, createTag } from '$server/services/crm-contacts.service';
import { TAG_SCOPE_MODULE, isTagScope } from '$lib/tags/scope';

/**
 * Scoped tag registry — `/api/tags?scope=` lists and `POST /api/tags` creates
 * a manual tag inside ONE scope (crm | stock | catalog | event). Not under an
 * `API_WRITE_PREFIXES` prefix (the gated module depends on the scope), so both
 * handlers gate explicitly on the scope's module, like `/api/tags/[kind]/[id]`.
 */
async function gate(locals: App.Locals, scopeRaw: string | null, action: 'view' | 'edit') {
  if (!isTagScope(scopeRaw)) throw error(400, 'scope must be one of crm, stock, catalog, event');
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const module = TAG_SCOPE_MODULE[scopeRaw];
  if (!(await isModuleEnabled(ctx, module))) throw error(404);
  await requireOrgCapability(locals, module, action);
  return { ctx, scope: scopeRaw };
}

/** GET /api/tags?scope=… → `{ tags: CalTag[] }` (manual tags only — auto/ai are contact classifiers). */
export const GET: RequestHandler = async ({ locals, url }) => {
  const { ctx, scope } = await gate(locals, url.searchParams.get('scope'), 'view');
  const rows = await listTags(ctx, scope);
  return json({
    tags: rows
      .filter((t) => t.kind === 'manual')
      .map((t) => ({ id: t.id, name: t.name, color: t.color })),
  });
};

const postSchema = z.object({
  scope: z.enum(['crm', 'stock', 'catalog', 'event']),
  name: z.string().trim().min(1).max(200),
  color: z.string().max(50).nullable().optional(),
});

/** POST /api/tags { scope, name, color? } → 201 `{ tag: CalTag }`. */
export const POST: RequestHandler = async ({ locals, request }) => {
  const b = await parseBody(request, postSchema);
  const { ctx, scope } = await gate(locals, b.scope, 'edit');
  try {
    const tag = await createTag(
      ctx,
      { name: b.name, color: b.color ?? null, kind: 'manual', scope },
      locals.user?.supabaseId ?? null,
    );
    return json({ tag: { id: tag.id, name: tag.name, color: tag.color } }, { status: 201 });
  } catch (e) {
    throw error(400, e instanceof Error ? e.message : 'Invalid tag');
  }
};
