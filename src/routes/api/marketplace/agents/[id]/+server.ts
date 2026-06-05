import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreDb } from '$server/db/pg-client';
import { getAgentWithFiles } from '$server/services/marketplace.service';

export const GET: RequestHandler = async ({ params }) => {
  const db = getCoreDb();
  const agent = await getAgentWithFiles(db, params.id!);

  if (!agent) throw error(404, 'Agent not found');

  return json({ agent });
};
