import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import overviewHtml from '$lib/artifacts/builtin/overview/index.html?raw';
import triageHtml from '$lib/artifacts/builtin/triage/index.html?raw';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { getArtifactRow } from '$lib/server/artifacts/store';

// Built-in artifact bundles, imported at build time (no runtime fs). Map lookup
// means there is no path-traversal surface.
const BUNDLES: Record<string, Record<string, { body: string; type: string }>> = {
  overview: {
    'index.html': { body: overviewHtml, type: 'text/html; charset=utf-8' },
  },
  triage: {
    'index.html': { body: triageHtml, type: 'text/html; charset=utf-8' },
  },
};

function serve(body: string, type: string): Response {
  return new Response(body, {
    headers: {
      'content-type': type,
      'content-security-policy': "frame-ancestors 'self'",
      'cache-control': 'no-store',
    },
  });
}

export const GET: RequestHandler = async ({ params, locals }) => {
  const builtin = BUNDLES[params.artifactId]?.[params.path];
  if (builtin) return serve(builtin.body, builtin.type);
  // DB (dynamic) artifact — org-scoped, single index.html
  if (params.path !== 'index.html') throw error(404, 'artifact asset not found');
  const ctx = await requireCoreCtx(locals);
  const row = await getArtifactRow(ctx, params.artifactId).catch(() => null);
  if (!row) throw error(404, 'artifact not found');
  return serve(row.html, 'text/html; charset=utf-8');
};
