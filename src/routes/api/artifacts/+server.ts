import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { createArtifactRow, artifactRowToDescriptor } from '$lib/server/artifacts/store';

export const POST: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const ctx = await requireCoreCtx(locals);
  const body = (await request.json().catch(() => null)) as
    | { agentId?: string; title?: string; description?: string; icon?: string; html?: string }
    | null;
  if (!body?.agentId || !body.title || !body.html) throw error(400, 'agentId, title, html required');
  const row = await createArtifactRow(ctx, {
    agentId: body.agentId,
    title: body.title,
    description: body.description ?? '',
    icon: body.icon || 'LayoutDashboard',
    html: body.html,
  });
  return json(artifactRowToDescriptor(row), { status: 201 });
};
