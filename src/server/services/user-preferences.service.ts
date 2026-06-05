import { eq } from 'drizzle-orm';
import { userPreferences } from '@minion-stack/db/pg';
import type { getCoreDb } from '$server/db/pg-client';

type CoreDb = ReturnType<typeof getCoreDb>;

/**
 * User preferences live in Supabase Postgres. They are keyed by `profile_id`
 * (profiles.id — the Supabase auth uuid), NOT the legacy bridged user id, so
 * callers must pass `locals.user.supabaseId`.
 */
export async function getUserPreferences(
  db: CoreDb,
  profileId: string,
): Promise<Record<string, unknown>> {
  const rows = await db
    .select({ section: userPreferences.section, value: userPreferences.value })
    .from(userPreferences)
    .where(eq(userPreferences.profileId, profileId));

  return Object.fromEntries(rows.map((r) => [r.section, JSON.parse(r.value)]));
}

export async function upsertUserPreference(
  db: CoreDb,
  profileId: string,
  section: string,
  value: unknown,
): Promise<void> {
  await db
    .insert(userPreferences)
    .values({
      profileId,
      section,
      value: JSON.stringify(value),
    })
    .onConflictDoUpdate({
      target: [userPreferences.profileId, userPreferences.section],
      set: {
        value: JSON.stringify(value),
        updatedAt: new Date(),
      },
    });
}
