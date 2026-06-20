import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { regenerateArtifactHtml } from '$lib/server/artifacts/builder';
import { getArtifactRow, snapshotRevision, updateArtifactHtml, artifactRowToDescriptor } from '$lib/server/artifacts/store';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  requireAdmin(locals);
  const ctx = await requireCoreCtx(locals);
  const body = (await request.json().catch(() => null)) as { refinement?: string } | null;
  if (!body?.refinement) throw error(400, 'refinement required');
  const current = await getArtifactRow(ctx, params.id);
  if (!current) throw error(404, 'artifact not found');
  let html: string;
  try { ({ html } = await regenerateArtifactHtml(ctx, { artifactId: params.id, refinement: body.refinement })); }
  catch (e) { throw error(502, `regeneration failed: ${(e as Error).message}`); }
  await snapshotRevision(ctx, current);
  const updated = await updateArtifactHtml(ctx, params.id, { html, prompt: body.refinement });
  return json(artifactRowToDescriptor(updated));
};
