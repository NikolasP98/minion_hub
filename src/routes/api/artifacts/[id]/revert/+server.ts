import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { getArtifactRow, snapshotRevision, updateArtifactHtml, getRevision, artifactRowToDescriptor } from '$lib/server/artifacts/store';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  requireAdmin(locals);
  const ctx = await requireCoreCtx(locals);
  const body = (await request.json().catch(() => null)) as { revisionId?: string } | null;
  if (!body?.revisionId) throw error(400, 'revisionId required');
  const rev = await getRevision(ctx, body.revisionId);
  if (!rev) throw error(404, 'revision not found');
  if (rev.artifactId !== params.id) throw error(400, 'revision does not belong to this artifact');
  const current = await getArtifactRow(ctx, params.id);
  if (!current) throw error(404, 'artifact not found');
  await snapshotRevision(ctx, current);
  const updated = await updateArtifactHtml(ctx, params.id, { html: rev.html, prompt: rev.prompt });
  return json(artifactRowToDescriptor(updated));
};
