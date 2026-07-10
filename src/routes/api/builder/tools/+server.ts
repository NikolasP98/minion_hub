import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { eq, desc } from 'drizzle-orm';
import { builtTools } from '@minion-stack/db/pg';
import { cached, invalidateTags, keys, tags } from '@minion-stack/cache';
import { newId } from '$server/db/utils';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';

export const GET: RequestHandler = async ({ locals }) => {
  await requireOrgCapability(locals, 'tools', 'view');
  const ctx = await requireCoreCtx(locals);
  // Built tools rarely change; cache the org's list for 30m. The 'builder' tag
  // is invalidated by every builtTools mutation (POST here + the service-layer
  // update/delete/publish used by /tools/[id]).
  const tools = await cached(
    keys.hub('builder', { t: ctx.tenantId, d: { resource: 'tools' } }),
    { ttl: '30m', tags: tags.tenantDomain(ctx.tenantId, 'builder') },
    () =>
      ctx.db
        .select()
        .from(builtTools)
        .where(eq(builtTools.tenantId, ctx.tenantId))
        .orderBy(desc(builtTools.updatedAt)),
  );
  return json({ tools });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  await requireOrgCapability(locals, 'tools', 'manage');
  const ctx = await requireCoreCtx(locals);
  const body = await request.json();
  const id = newId();
  await ctx.db.insert(builtTools).values({
    id,
    name: body.name ?? 'Untitled Tool',
    description: body.description ?? '',
    scriptCode: body.scriptCode ?? '// Write your tool script here\n',
    scriptLang: body.scriptLang ?? 'javascript',
    status: 'draft',
    tenantId: ctx.tenantId,
  });
  await invalidateTags(tags.tenantDomain(ctx.tenantId, 'builder'));
  return json({ id }, { status: 201 });
};
