import { desc, eq } from 'drizzle-orm';
import { getCoreDb } from '$server/db/pg-client';
import { emailOpens } from '$server/db/pg-schema/email-opens';

/**
 * Hub-only "opened in the hub" state for feed emails, synced across devices.
 * Personal data — always code-scoped by userId (no RLS, mirrors `notes`).
 */

/** Gmail message ids this user has opened, newest first (capped). */
export async function listOpenedIds(userId: string, limit = 1000): Promise<string[]> {
  if (!userId) return [];
  const rows = await getCoreDb()
    .select({ id: emailOpens.gmailMessageId })
    .from(emailOpens)
    .where(eq(emailOpens.userId, userId))
    .orderBy(desc(emailOpens.openedAt))
    .limit(limit);
  return rows.map((r) => r.id);
}

/** Mark one message opened for this user. Idempotent. */
export async function markOpened(userId: string, gmailMessageId: string): Promise<void> {
  if (!userId || !gmailMessageId) return;
  await getCoreDb()
    .insert(emailOpens)
    .values({ userId, gmailMessageId })
    .onConflictDoNothing();
}
