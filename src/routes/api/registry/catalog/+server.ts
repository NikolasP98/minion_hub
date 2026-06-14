import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cached, keys, tags } from '@minion-stack/cache';
import { assertSafeUrl } from '$server/services/ssrf-guard';

interface CachedCatalog {
  agents: unknown[];
  hash: string;
  fetchedAt: number;
}

const B2_PUBLIC_URL = 'https://s3.us-east-005.backblazeb2.com/minion-db/registry/catalog.json';

// Global (not tenant-scoped): the registry is the same for every tenant. Backed
// by Valkey in prod (CACHE_BACKEND=valkey), so it survives Vercel cold starts —
// the old module-level `let cached` died on every cold boot and re-hit B2.
async function fetchCatalog(): Promise<CachedCatalog> {
  return cached(
    keys.hub('registry', { d: { resource: 'catalog' } }),
    { ttl: '5m', swr: '1h', tags: tags.global('registry') },
    async () => {
      let raw: string;

      const localPath = process.env.REGISTRY_CATALOG_PATH;
      if (localPath) {
        try {
          raw = await readFile(localPath, 'utf-8');
        } catch {
          throw new Error(`Local catalog not found: ${localPath}`);
        }
      } else {
        const url = process.env.REGISTRY_CATALOG_URL ?? B2_PUBLIC_URL;
        await assertSafeUrl(url, 'REGISTRY_CATALOG_URL');
        const res = await fetch(url);
        if (!res.ok) throw new Error(`B2 fetch failed: HTTP ${res.status}`);
        raw = await res.text();
      }

      const parsed = JSON.parse(raw);
      const agents: unknown[] = Array.isArray(parsed) ? parsed : (parsed.agents ?? []);
      const hash = createHash('sha256').update(raw).digest('hex').slice(0, 16);

      return { agents, hash, fetchedAt: Date.now() };
    },
  );
}

export const GET: RequestHandler = async ({ request }) => {
  try {
    const catalog = await fetchCatalog();

    // ETag support — return 304 if client has current version
    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch === `"${catalog.hash}"`) {
      return new Response(null, { status: 304, headers: { ETag: `"${catalog.hash}"` } });
    }

    return json(catalog.agents, {
      headers: {
        ETag: `"${catalog.hash}"`,
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
      },
    });
  } catch (e) {
    console.error('[registry] Failed to fetch catalog:', e);
    return json([], { status: 502 });
  }
};
