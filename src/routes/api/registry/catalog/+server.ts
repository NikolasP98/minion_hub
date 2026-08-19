import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cached, keys, tags } from '@minion-stack/cache';
import { assertSafeUrl } from '$server/services/ssrf-guard';
import { getStorage, isStorageConfigured } from '$server/storage/blob';

interface CachedCatalog {
  agents: unknown[];
  hash: string;
  fetchedAt: number;
}

/**
 * Object key of the catalog inside the storage bucket.
 *
 * Read through the authenticated storage driver rather than a hardcoded public
 * URL. The bucket held per-tenant content (mirrored Meta creative, note
 * attachments) and encrypted brain snapshots alongside this registry, and a
 * public-read bucket made every one of those objects fetchable by anyone who
 * knew the key — which also made the presigned URLs elsewhere in the app
 * pointless. B2 bucket visibility is all-or-nothing with no per-prefix ACL, so
 * the registry had to stop depending on anonymous reads before the bucket could
 * be closed.
 */
const CATALOG_KEY = 'registry/catalog.json';

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
      } else if (process.env.REGISTRY_CATALOG_URL) {
        // Explicit override still wins — an operator pointing at a mirror or a
        // CDN should not be forced through our bucket credentials.
        const url = process.env.REGISTRY_CATALOG_URL;
        await assertSafeUrl(url, 'REGISTRY_CATALOG_URL');
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Registry fetch failed: HTTP ${res.status}`);
        raw = await res.text();
      } else {
        if (!isStorageConfigured()) {
          throw new Error('Registry catalog unavailable: blob storage is not configured');
        }
        // Presign, then fetch. The driver only exposes a signed URL (no getObject),
        // and signing keeps the credentials server-side — the browser never sees
        // this URL, so a short expiry is fine.
        const signed = await getStorage().getSignedUrl(CATALOG_KEY, 300);
        const res = await fetch(signed);
        if (!res.ok) throw new Error(`Registry fetch failed: HTTP ${res.status}`);
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
