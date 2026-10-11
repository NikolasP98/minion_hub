import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { upsertRelease, type ReleaseDraft } from '$server/services/releases/releases.service';

interface ReleaseBody {
  version?: unknown;
  releasedAt?: unknown;
  sections?: unknown;
  prs?: unknown;
}

/**
 * POST /api/releases — cron-auth entrypoint the release-notes GitHub Action
 * POSTs to after it tags a release (`.github/workflows/release-notes.yml`).
 * Bearer $CRON_SECRET, same shape as the other cron-auth routes
 * (`$lib/server/cron-auth-path.ts`). Upserts `app_releases` by version and
 * creates the one global `app.update` notification (idempotent on repeat).
 */
export const POST: RequestHandler = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) throw error(401);

  const body = (await request.json().catch(() => null)) as ReleaseBody | null;
  if (!body || typeof body.version !== 'string' || typeof body.releasedAt !== 'string') {
    throw error(400, 'version and releasedAt (ISO string) are required');
  }

  const result = await upsertRelease({
    version: body.version,
    releasedAt: body.releasedAt,
    sections:
      body.sections && typeof body.sections === 'object'
        ? (body.sections as Record<string, unknown>)
        : {},
    prs: Array.isArray(body.prs) ? (body.prs as ReleaseDraft['prs']) : [],
  });

  return json(result);
};
