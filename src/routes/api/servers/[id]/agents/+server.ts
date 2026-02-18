import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { listAgents, upsertAgents } from '$lib/../server/db';
import type { Agent } from '$lib/types/gateway';

export const GET: RequestHandler = async ({ params }) => {
  try {
    const agents = await listAgents(params.id!);
    return json({ agents });
  } catch {
    return json({ agents: [] });
  }
};

export const POST: RequestHandler = async ({ params, request }) => {
  try {
    const body = (await request.json()) as { agents: Agent[] };
    await upsertAgents(params.id!, body.agents ?? []);
    return json({ ok: true });
  } catch {
    return json({ ok: true });
  }
};
