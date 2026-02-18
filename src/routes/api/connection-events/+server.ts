import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/../server/db';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = (await request.json()) as {
      event_type: string;
      host_name?: string;
      host_url?: string;
      duration_ms?: number;
      reason?: string;
    };

    const db = await getDb();
    if (!db) return json({ ok: true });

    await db.execute({
      sql: `INSERT INTO connection_events (event_type, host_name, host_url, duration_ms, reason)
            VALUES (?, ?, ?, ?, ?)`,
      args: [body.event_type, body.host_name ?? null, body.host_url ?? null, body.duration_ms ?? null, body.reason ?? null],
    });

    return json({ ok: true });
  } catch {
    return json({ ok: true });
  }
};
