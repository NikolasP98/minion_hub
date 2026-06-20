import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { generateArtifactHtml } from '$lib/server/artifacts/builder';
import { createArtifactRow, artifactRowToDescriptor } from '$lib/server/artifacts/store';

export const POST: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const ctx = await requireCoreCtx(locals);
  const body = (await request.json().catch(() => null)) as
    | { agentId?: string; title?: string; icon?: string; description?: string; prompt?: string }
    | null;
  if (!body?.agentId || !body.title || !body.prompt) throw error(400, 'agentId, title, prompt required');
  let html: string;
  try {
    html = await generateArtifactHtml(ctx, { agentId: body.agentId, prompt: body.prompt });
  } catch (e) {
    throw error(502, `generation failed: ${(e as Error).message}`);
  }
  const row = await createArtifactRow(ctx, {
    agentId: body.agentId, title: body.title, description: body.description ?? '',
    icon: body.icon || 'LayoutDashboard', html,
  });
  return json(artifactRowToDescriptor(row), { status: 201 });
};
