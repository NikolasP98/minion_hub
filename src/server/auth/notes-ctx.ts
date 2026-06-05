import { getCoreDb } from '$server/db/pg-client';
import { getTenantCtx } from '$server/auth/tenant-ctx';

/**
 * Notes context: the Supabase-Postgres core db + the resolved org (tenant) id +
 * the owning user id.
 *
 * Like `getFlowsCtx`, but ALSO carries `userId` because notes are personal —
 * visibility is gated by `user_id`, not just `tenant_id`. Storage lives in
 * Supabase Postgres (via getCoreDb); the org id is resolved from the Turso
 * `organization` table by getTenantCtx (tenant_id on note rows is a cross-DB
 * reference, same pattern as flows).
 *
 * Returns null if there's no authenticated user (notes require a real owner).
 */
export interface NotesCtx {
  db: ReturnType<typeof getCoreDb>;
  tenantId: string;
  userId: string;
}

export async function getNotesCtx(locals: App.Locals): Promise<NotesCtx | null> {
  if (!locals.user) return null;
  const base = await getTenantCtx(locals);
  if (!base) return null;
  return { db: getCoreDb(), tenantId: base.tenantId, userId: locals.user.id };
}
