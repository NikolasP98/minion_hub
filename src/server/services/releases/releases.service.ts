import { desc } from 'drizzle-orm';
import * as m from '$lib/paraglide/messages';
import { getCoreDb } from '$server/db/pg-client';
import { appReleases, type AppRelease } from '$server/db/pg-release-schema';
import { upsertNotification } from '$server/services/inbox/inbox.service';
import type { CoreCtx } from '$server/auth/core-ctx';
import { groupReleasesByDay, releaseDayKey } from './release-day';

export interface ReleaseDraft {
  version: string;
  releasedAt: string;
  sections: Record<string, unknown>;
  prs: Array<{ number: number; title: string; url: string }>;
}

/**
 * `upsertNotification`/`withOrgCore` need a non-empty `tenantId` to SET the
 * transaction's `app.current_org_id` GUC, but a release is a `scope: global`
 * row (`org_id` stays null) — the RLS policy on `app_notifications` admits a
 * null `org_id` regardless of that GUC's value (see inbox.service.ts
 * `upsertNotification`'s own comment), so any non-empty placeholder works.
 * This is not a real organization id.
 */
// Built per call, never at module scope: SvelteKit's postbuild analyse imports
// every server chunk, and a preview build has no SUPABASE_DB_URL.
const releaseProducerCtx = (): CoreCtx => ({ db: getCoreDb(), tenantId: 'system' });

/**
 * Producer for `POST /api/releases` (the release-notes GitHub Action):
 * upsert the release row by `version`, then create (or no-op on repeat) the
 * ONE global `app.update` notification every signed-in user sees — one per
 * DAY: later pushes the same day (`hub-vYYYY.MM.DD-n`) share the day's
 * notification and anchor (owner 2026-10-14, see release-day.ts).
 */
export async function upsertRelease(
  draft: ReleaseDraft,
): Promise<{ releaseId: string; notificationId: string }> {
  const db = getCoreDb();
  const releasedAt = new Date(draft.releasedAt);
  const [row] = await db
    .insert(appReleases)
    .values({
      version: draft.version,
      releasedAt,
      sections: draft.sections,
      prs: draft.prs,
    })
    .onConflictDoUpdate({
      target: appReleases.version,
      set: { releasedAt, sections: draft.sections, prs: draft.prs },
    })
    .returning({ id: appReleases.id });

  const day = releaseDayKey(draft.version);
  const notificationId = await upsertNotification(releaseProducerCtx(), {
    scope: 'global',
    kind: 'app.update',
    severity: 'info',
    title: m.changelog_novedades({ version: day }),
    href: `/changelog#${day}`,
    dedupeKey: `release:${day}`,
  });

  return { releaseId: row.id, notificationId };
}

/** `GET /changelog`: one entry per day, newest first, every signed-in user —
 *  no tenant scope. */
export async function listReleases(): Promise<AppRelease[]> {
  const rows = await getCoreDb().select().from(appReleases).orderBy(desc(appReleases.releasedAt));
  return groupReleasesByDay(rows);
}
