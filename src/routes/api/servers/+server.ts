import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { listServers, upsertServer } from '$lib/../server/db';
import type { Host } from '$lib/types/host';

export const GET: RequestHandler = async () => {
  try {
    const servers = await listServers();
    return json({ servers });
  } catch {
    return json({ servers: [] });
  }
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = (await request.json()) as Host;
    await upsertServer(body);
    return json({ ok: true });
  } catch {
    return json({ ok: true });
  }
};
