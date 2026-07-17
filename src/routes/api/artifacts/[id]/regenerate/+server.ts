import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { regenerateArtifactHtml } from '$lib/server/artifacts/builder';
import { getArtifactRow, snapshotRevision, updateArtifactHtml, artifactRowToDescriptor } from '$lib/server/artifacts/store';
import { ndjsonBuild } from '$lib/server/artifacts/build-stream';

// ponytail: 300s is the Vercel Pro ceiling; on Hobby it's hard-capped to 60s.

export const POST: RequestHandler = async ({ locals, params, request }) => {
  requireAdmin(locals);
  const ctx = await requireCoreCtx(locals);
  const body = (await request.json().catch(() => null)) as { refinement?: string } | null;
  if (!body?.refinement?.trim()) throw error(400, 'refinement required');
  if (!(await getArtifactRow(ctx, params.id))) throw error(404, 'artifact not found');

  return ndjsonBuild(async (emit) => {
    const { html } = await regenerateArtifactHtml(ctx, { artifactId: params.id, refinement: body.refinement!.trim() }, emit);
    // Re-fetch after the (slow) build so the snapshot records the row we're
    // actually about to overwrite, not a stale pre-build version.
    const current = await getArtifactRow(ctx, params.id);
    if (!current) throw error(404, 'artifact not found');
    await snapshotRevision(ctx, current);
    const updated = await updateArtifactHtml(ctx, params.id, { html, prompt: body.refinement!.trim() });
    return artifactRowToDescriptor(updated);
  });
};
