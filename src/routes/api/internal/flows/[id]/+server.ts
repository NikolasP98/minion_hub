import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { flows } from '$server/db/pg-schema/flows';
import { eq } from 'drizzle-orm';
import { getCoreDb } from '$server/db/pg-client';
import { env } from '$env/dynamic/private';

/**
 * Internal endpoint for langgraph-server to fetch flow nodes+edges by ID.
 * Requires Authorization: Bearer <HUB_API_TOKEN>. FAIL CLOSED: if the env var
 * is unset this endpoint refuses — /api/internal/* bypasses user auth, so an
 * unset token must not mean "open to the internet".
 */
export const GET: RequestHandler = async ({ params, request }) => {
  const authHeader = request.headers.get('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const expectedToken = env.HUB_API_TOKEN ?? '';

  if (!expectedToken || token !== expectedToken) {
    throw error(401, 'Unauthorized');
  }

  const db = getCoreDb();
  const [flow] = await db.select().from(flows).where(eq(flows.id, params.id!)).limit(1);
  if (!flow) throw error(404, 'Flow not found');

  return json({
    nodes: JSON.parse(flow.nodes),
    edges: JSON.parse(flow.edges),
  });
};
