import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { cached, keys, tags } from '@minion-stack/cache';
import { assertSafeUrl } from '$server/services/ssrf-guard';

const B2_INDEX_URL = 'https://s3.us-east-005.backblazeb2.com/minion-db/registry/index.json';

// Global (not tenant-scoped) + Valkey-backed in prod, so it survives Vercel cold
// starts (the old module-level `let cached` did not). Shares the 'registry' tag
// with the catalog endpoint so both invalidate together.
async function fetchIndex(): Promise<unknown> {
  return cached(
    keys.hub('registry', { d: { resource: 'version' } }),
    { ttl: '1m', swr: '5m', tags: tags.global('registry') },
    async () => {
      const localPath = process.env.REGISTRY_CATALOG_PATH;
      if (localPath) {
        // In dev, derive hash from local catalog file
        const { createHash } = await import('node:crypto');
        const raw = await readFile(localPath, 'utf-8');
        const hash = createHash('sha256').update(raw).digest('hex').slice(0, 16);
        return { schemaVersion: 3, hash, builtAt: new Date().toISOString() };
      }

      const indexUrl = process.env.REGISTRY_INDEX_URL ?? B2_INDEX_URL;
      await assertSafeUrl(indexUrl, 'REGISTRY_INDEX_URL');
      const res = await fetch(indexUrl);
      if (!res.ok) throw new Error(`B2 fetch failed: HTTP ${res.status}`);
      return res.json();
    },
  );
}

export const GET: RequestHandler = async () => {
  try {
    const index = await fetchIndex();
    return json(index, {
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
    });
  } catch (e) {
    console.error('[registry] Failed to fetch version:', e);
    return json({ error: 'Failed to fetch registry version' }, { status: 502 });
  }
};
