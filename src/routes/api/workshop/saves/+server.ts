import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$server/db/client';
import { workshopSaves } from '$server/db/schema';
import { desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export const GET: RequestHandler = async () => {
  const db = getDb();
  const saves = await db
    .select()
    .from(workshopSaves)
    .orderBy(desc(workshopSaves.updatedAt));

  return json({ saves });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { name, state } = body as { name?: string; state?: string };

  if (!name || typeof name !== 'string') throw error(400, 'name is required');
  if (!state || typeof state !== 'string') throw error(400, 'state is required');

  // Validate that state is valid JSON
  try {
    JSON.parse(state);
  } catch {
    throw error(400, 'state must be valid JSON');
  }

  const db = getDb();
  const id = randomUUID();
  const now = Date.now();

  await db.insert(workshopSaves).values({
    id,
    name,
    state,
    createdAt: now,
    updatedAt: now,
  });

  return json({ id, ok: true });
};
