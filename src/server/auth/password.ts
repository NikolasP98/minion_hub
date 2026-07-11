import { sql } from 'drizzle-orm';
import { getCoreDb } from '$server/db/pg-client';

/**
 * Whether the given Supabase user already has a password set, as opposed to
 * being OAuth-only (e.g. Google). Used to decide "set password" vs "change
 * password" UX and whether `currentPassword` must be verified on
 * `/api/me/password`.
 *
 * Checks `auth.users.encrypted_password` directly: GoTrue does NOT create an
 * `email` identity when a password is set via `admin.updateUserById`, so the
 * identities list is not a reliable signal. Errors propagate (fail closed) —
 * returning false on failure would skip currentPassword verification.
 */
export async function hasPasswordIdentity(supabaseId: string): Promise<boolean> {
  const rows = await getCoreDb().execute(
    sql`select (encrypted_password is not null and encrypted_password <> '') as has_password
        from auth.users where id = ${supabaseId}`,
  );
  const row = rows[0] as { has_password?: boolean } | undefined;
  if (!row) throw new Error(`auth user not found: ${supabaseId}`);
  return row.has_password === true;
}
