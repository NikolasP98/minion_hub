import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$server/db/client';
import { flows } from '$server/db/schema';
import { desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export const GET: RequestHandler = async () => {
  const db = getDb();
  const rows = await db.select().from(flows).orderBy(desc(flows.updatedAt));

  const result = rows.map((row) => {
    let nodeCount = 0;
    try {
      nodeCount = JSON.parse(row.nodes).length;
    } catch {
      // leave at 0
    }
    return {
      id: row.id,
      name: row.name,
      nodeCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });

  return json({ flows: result });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { name } = body as { name?: string };

  if (!name || typeof name !== 'string') throw error(400, 'name is required');

  const db = getDb();
  const id = randomUUID();
  const now = Date.now();

  await db.insert(flows).values({
    id,
    name,
    nodes: '[]',
    edges: '[]',
    createdAt: now,
    updatedAt: now,
  });

  return json({ id }, { status: 201 });
};
