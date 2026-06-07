import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$server/db/client';
import { invitation } from '@minion-stack/db/schema';
import { supabaseAdmin } from '$server/supabase';
import { eq } from 'drizzle-orm';

/**
 * Public endpoint — no auth required.
 * The invitation ID is a random CUID; knowing it is equivalent to having the invite link.
 *
 * Legacy Better-Auth invite-link preview. The org name is resolved from Supabase
 * `organizations` (the Turso `organization` join was removed — Supabase is the
 * tenancy store). Best-effort: null name if the org can't be resolved.
 */
export const GET: RequestHandler = async ({ params }) => {
  const db = getDb();
  const rows = await db
    .select({
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      organizationId: invitation.organizationId,
    })
    .from(invitation)
    .where(eq(invitation.id, params.id))
    .limit(1);

  if (rows.length === 0) {
    return json({ error: 'Invitation not found' }, { status: 404 });
  }

  const row = rows[0];
  let organizationName: string | null = null;
  try {
    const { data } = await supabaseAdmin()
      .from('organizations')
      .select('name')
      .eq('id', row.organizationId)
      .maybeSingle();
    organizationName = (data as { name?: string } | null)?.name ?? null;
  } catch {
    // best-effort
  }

  return json({
    email: row.email,
    role: row.role,
    status: row.status,
    organizationName,
    expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt,
  });
};
