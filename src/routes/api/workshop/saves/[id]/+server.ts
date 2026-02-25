import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$server/db/client';
import { workshopSaves } from '$server/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
  const db = getDb();
  const [save] = await db
    .select()
    .from(workshopSaves)
    .where(eq(workshopSaves.id, params.id!));

  if (!save) throw error(404, 'Save not found');

  return json({
    save: {
      ...save,
      state: JSON.parse(save.state),
    },
  });
};

export const PUT: RequestHandler = async ({ params, request }) => {
  const db = getDb();

  // Verify save exists
  const [existing] = await db
    .select()
    .from(workshopSaves)
    .where(eq(workshopSaves.id, params.id!));

  if (!existing) throw error(404, 'Save not found');

  const body = await request.json();
  const { name, state, thumbnail } = body as { name?: string; state?: string; thumbnail?: string };

  const updates: Record<string, unknown> = { updatedAt: Date.now() };

  if (name !== undefined) {
    if (typeof name !== 'string' || !name) throw error(400, 'name must be a non-empty string');
    updates.name = name;
  }

  if (state !== undefined) {
    if (typeof state !== 'string') throw error(400, 'state must be a JSON string');
    try {
      JSON.parse(state);
    } catch {
      throw error(400, 'state must be valid JSON');
    }
    updates.state = state;
  }

  if (thumbnail !== undefined) {
    updates.thumbnail = typeof thumbnail === 'string' ? thumbnail : null;
  }

  await db
    .update(workshopSaves)
    .set(updates)
    .where(eq(workshopSaves.id, params.id!));

  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params }) => {
  const db = getDb();

  const [existing] = await db
    .select()
    .from(workshopSaves)
    .where(eq(workshopSaves.id, params.id!));

  if (!existing) throw error(404, 'Save not found');

  await db
    .delete(workshopSaves)
    .where(eq(workshopSaves.id, params.id!));

  return json({ ok: true });
};
