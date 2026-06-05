import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { eq, desc } from 'drizzle-orm';
import { builtTools } from '@minion-stack/db/pg';
import { newId } from '$server/db/utils';
import { requireCoreCtx } from '$server/auth/core-ctx';

export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await requireCoreCtx(locals);
  const tools = await ctx.db
    .select()
    .from(builtTools)
    .where(eq(builtTools.tenantId, ctx.tenantId))
    .orderBy(desc(builtTools.updatedAt));
  return json({ tools });
};

export const POST: RequestHandler = async ({ locals, request }) => {
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
  return json({ id }, { status: 201 });
};
