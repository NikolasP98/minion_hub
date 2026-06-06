import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { workshopSaves } from '@minion-stack/db/pg';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { requireAuth } from '$server/auth/authorize';
import { getCoreCtx } from '$server/auth/core-ctx';

export const GET: RequestHandler = async ({ locals }) => {
  const user = requireAuth(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const profileId = user.supabaseId ?? null;

  // Saves owned by this user (by profile uuid) OR legacy ownerless rows
  // (admin-visible only), scoped to the active tenant.
  const rows = await ctx.db
    .select()
    .from(workshopSaves)
    .where(
      and(
        profileId
          ? or(eq(workshopSaves.profileId, profileId), isNull(workshopSaves.profileId))
          : isNull(workshopSaves.profileId),
        or(eq(workshopSaves.tenantId, ctx.tenantId), isNull(workshopSaves.tenantId)),
      ),
    )
    .orderBy(desc(workshopSaves.updatedAt));

  const saves = rows.map((row) => {
    let agentCount = 0;
    let elementCount = 0;
    try {
      const s = JSON.parse(row.state);
      agentCount = Object.keys(s.agents ?? {}).length;
      elementCount = Object.keys(s.elements ?? {}).length;
    } catch {
      // non-critical — leave counts at 0
    }
    return {
      id: row.id,
      name: row.name,
      updatedAt: row.updatedAt.getTime(),
      createdAt: row.createdAt.getTime(),
      thumbnail: row.thumbnail ?? null,
      agentCount,
      elementCount,
    };
  });

  return json({ saves });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const user = requireAuth(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);

  const body = await request.json();
  const { name, state, thumbnail } = body as { name?: string; state?: string; thumbnail?: string };

  if (!name || typeof name !== 'string') throw error(400, 'name is required');
  if (!state || typeof state !== 'string') throw error(400, 'state is required');

  // Validate that state is valid JSON
  try {
    JSON.parse(state);
  } catch {
    throw error(400, 'state must be valid JSON');
  }

  const id = randomUUID();

  try {
    await ctx.db.insert(workshopSaves).values({
      id,
      name,
      state,
      thumbnail: typeof thumbnail === 'string' ? thumbnail : null,
      profileId: user.supabaseId ?? null,
      tenantId: ctx.tenantId,
    });
  } catch (err) {
    console.error('[workshop saves POST] db insert failed:', err);
    throw error(
      500,
      `Failed to save workspace: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return json({ id, ok: true });
};
