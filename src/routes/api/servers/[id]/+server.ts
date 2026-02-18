import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { upsertServer, deleteServer } from '$lib/../server/db';
import type { Host } from '$lib/types/host';

export const PUT: RequestHandler = async ({ params, request }) => {
  try {
    const body = (await request.json()) as Partial<Host>;
    const id = params.id!;
    await upsertServer({ id, name: '', url: '', token: '', lastConnectedAt: null, ...body });
    return json({ ok: true });
  } catch {
    return json({ ok: true });
  }
};

export const DELETE: RequestHandler = async ({ params }) => {
  try {
    await deleteServer(params.id!);
    return json({ ok: true });
  } catch {
    return json({ ok: true });
  }
};
