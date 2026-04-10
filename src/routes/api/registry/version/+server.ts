import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { assertSafeUrl } from '$server/services/ssrf-guard';

const B2_INDEX_URL = 'https://s3.us-east-005.backblazeb2.com/minion-db/registry/index.json';
const CACHE_TTL_MS = 60 * 1000; // 1 min

let cached: { data: unknown; fetchedAt: number } | null = null;

async function fetchIndex(): Promise<unknown> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const localPath = process.env.REGISTRY_CATALOG_PATH;
  if (localPath) {
    // In dev, derive hash from local catalog file
    const { createHash } = await import('node:crypto');
    const raw = await readFile(localPath, 'utf-8');
    const hash = createHash('sha256').update(raw).digest('hex').slice(0, 16);
    const data = { schemaVersion: 3, hash, builtAt: new Date().toISOString() };
    cached = { data, fetchedAt: Date.now() };
    return data;
  }

  const indexUrl = process.env.REGISTRY_INDEX_URL ?? B2_INDEX_URL;
  await assertSafeUrl(indexUrl, 'REGISTRY_INDEX_URL');
  const res = await fetch(indexUrl);
  if (!res.ok) throw new Error(`B2 fetch failed: HTTP ${res.status}`);
  const data = await res.json();
  cached = { data, fetchedAt: Date.now() };
  return data;
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
