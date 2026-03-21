import { eq } from 'drizzle-orm';
import { userPreferences } from '$server/db/schema';
import { nowMs } from '$server/db/utils';
import type { Db } from '$server/db/client';

export async function getUserPreferences(
  db: Db,
  userId: string,
): Promise<Record<string, unknown>> {
  const rows = await db
    .select({ section: userPreferences.section, value: userPreferences.value })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId));

  return Object.fromEntries(rows.map((r) => [r.section, JSON.parse(r.value)]));
}

export async function upsertUserPreference(
  db: Db,
  userId: string,
  section: string,
  value: unknown,
): Promise<void> {
  const now = nowMs();
  await db
    .insert(userPreferences)
    .values({
      userId,
      section,
      value: JSON.stringify(value),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [userPreferences.userId, userPreferences.section],
      set: {
        value: JSON.stringify(value),
        updatedAt: now,
      },
    });
}
