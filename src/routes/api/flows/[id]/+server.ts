import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$server/db/client';
import { flows } from '$server/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
  const db = getDb();
  const [row] = await db.select().from(flows).where(eq(flows.id, params.id!));

  if (!row) throw error(404, 'Flow not found');

  return json({
    flow: {
      ...row,
      nodes: JSON.parse(row.nodes),
      edges: JSON.parse(row.edges),
    },
  });
};

export const PUT: RequestHandler = async ({ params, request }) => {
  const db = getDb();
  const [existing] = await db.select().from(flows).where(eq(flows.id, params.id!));
  if (!existing) throw error(404, 'Flow not found');

  const body = await request.json();
  const { name, nodes, edges } = body as { name?: string; nodes?: unknown[]; edges?: unknown[] };

  const updates: Record<string, unknown> = { updatedAt: Date.now() };
  if (name !== undefined) updates.name = name;
  if (nodes !== undefined) updates.nodes = JSON.stringify(nodes);
  if (edges !== undefined) updates.edges = JSON.stringify(edges);

  await db.update(flows).set(updates).where(eq(flows.id, params.id!));

  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params }) => {
  const db = getDb();
  const [existing] = await db.select().from(flows).where(eq(flows.id, params.id!));
  if (!existing) throw error(404, 'Flow not found');

  await db.delete(flows).where(eq(flows.id, params.id!));

  return json({ ok: true });
};
