import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { listBuiltAgents, createBuiltAgent } from '$server/services/builder.service';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';

export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getOrCreateTenantCtx(locals);
  if (!ctx) throw error(401);
  const agents = await listBuiltAgents(ctx);
  return json({ agents });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getOrCreateTenantCtx(locals);
  if (!ctx) throw error(401);
  const body = await request.json();
  const { id } = await createBuiltAgent(ctx, body);
  return json({ id }, { status: 201 });
};
