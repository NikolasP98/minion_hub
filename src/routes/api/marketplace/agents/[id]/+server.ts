import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreDb } from '$server/db/pg-client';
import { getAgentWithFiles } from '$server/services/marketplace.service';
import { unavailableDocumentsResponse } from '$server/services/marketplace/http';

export const GET: RequestHandler = async ({ params }) => {
  try {
    const agent = await getAgentWithFiles(getCoreDb(), params.id!);
    if (!agent) throw error(404, 'Agent not found');
    return json({ agent }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    const unavailable = unavailableDocumentsResponse(cause);
    if (unavailable) return unavailable;
    throw cause;
  }
};
