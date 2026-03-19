import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { listBuiltSkills, createBuiltSkill } from '$server/services/builder.service';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';

export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getOrCreateTenantCtx(locals);
  if (!ctx) throw error(401);
  const status = url.searchParams.get('status');
  const opts = status === 'published' || status === 'draft' ? { status } : undefined;
  const skills = await listBuiltSkills(ctx, opts);
  return json({ skills });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getOrCreateTenantCtx(locals);
  if (!ctx) throw error(401);
  const body = await request.json();
  const { id } = await createBuiltSkill(ctx, body);
  return json({ id }, { status: 201 });
};
