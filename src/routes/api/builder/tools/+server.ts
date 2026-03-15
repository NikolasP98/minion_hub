import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { eq, desc } from 'drizzle-orm';
import { builtTools } from '$server/db/schema';
import { newId, nowMs } from '$server/db/utils';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';

export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getOrCreateTenantCtx(locals);
  if (!ctx) throw error(401);
  const tools = await ctx.db
    .select()
    .from(builtTools)
    .where(eq(builtTools.tenantId, ctx.tenantId))
    .orderBy(desc(builtTools.updatedAt));
  return json({ tools });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getOrCreateTenantCtx(locals);
  if (!ctx) throw error(401);
  const body = await request.json();
  const now = nowMs();
  const id = newId();
  await ctx.db.insert(builtTools).values({
    id,
    name: body.name ?? 'Untitled Tool',
    description: body.description ?? '',
    scriptCode: body.scriptCode ?? '// Write your tool script here\n',
    scriptLang: body.scriptLang ?? 'javascript',
    status: 'draft',
    tenantId: ctx.tenantId,
    createdAt: now,
    updatedAt: now,
  });
  return json({ id }, { status: 201 });
};
