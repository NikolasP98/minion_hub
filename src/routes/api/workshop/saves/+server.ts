import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$server/db/client';
import { workshopSaves } from '$server/db/schema';
import { desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export const GET: RequestHandler = async () => {
  const db = getDb();
  const rows = await db
    .select()
    .from(workshopSaves)
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
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
      thumbnail: row.thumbnail ?? null,
      agentCount,
      elementCount,
    };
  });

  return json({ saves });
};

export const POST: RequestHandler = async ({ request }) => {
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

  const db = getDb();
  const id = randomUUID();
  const now = Date.now();

  try {
    await db.insert(workshopSaves).values({
      id,
      name,
      state,
      thumbnail: typeof thumbnail === 'string' ? thumbnail : null,
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    console.error('[workshop saves POST] db insert failed:', err);
    throw error(500, `Failed to save workspace: ${err instanceof Error ? err.message : String(err)}`);
  }

  return json({ id, ok: true });
};
