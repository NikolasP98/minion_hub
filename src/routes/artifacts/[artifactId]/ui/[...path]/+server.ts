import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import overviewHtml from '$lib/artifacts/builtin/overview/index.html?raw';

// Built-in artifact bundles, imported at build time (no runtime fs). Map lookup
// means there is no path-traversal surface.
const BUNDLES: Record<string, Record<string, { body: string; type: string }>> = {
  overview: {
    'index.html': { body: overviewHtml, type: 'text/html; charset=utf-8' },
  },
};

export const GET: RequestHandler = ({ params }) => {
  const file = BUNDLES[params.artifactId]?.[params.path];
  if (!file) throw error(404, 'artifact asset not found');
  return new Response(file.body, {
    headers: {
      'content-type': file.type,
      // Only the hub may embed artifacts.
      'content-security-policy': "frame-ancestors 'self'",
      'cache-control': 'no-store',
    },
  });
};
