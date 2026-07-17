import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { generateArtifactHtml } from '$lib/server/artifacts/builder';
import { createArtifactRow, artifactRowToDescriptor } from '$lib/server/artifacts/store';
import { ndjsonBuild } from '$lib/server/artifacts/build-stream';

// ponytail: 300s is the Vercel Pro ceiling; on Hobby it's hard-capped to 60s.
// Streaming keeps the client alive but does NOT raise this limit.

export const POST: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const ctx = await requireCoreCtx(locals);
  const body = (await request.json().catch(() => null)) as
    | { agentId?: string; title?: string; icon?: string; description?: string; prompt?: string }
    | null;
  if (!body?.agentId || !body.title || !body.prompt) throw error(400, 'agentId, title, prompt required');

  return ndjsonBuild(async (emit) => {
    const html = await generateArtifactHtml(ctx, { agentId: body.agentId!, prompt: body.prompt! }, emit);
    const row = await createArtifactRow(ctx, {
      agentId: body.agentId!, title: body.title!, description: body.description ?? '',
      icon: body.icon || 'LayoutDashboard', html,
    });
    return artifactRowToDescriptor(row);
  });
};
