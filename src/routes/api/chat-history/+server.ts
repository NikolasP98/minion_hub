import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/../server/db';

export const GET: RequestHandler = async ({ url }) => {
  const agentId = url.searchParams.get('agentId');
  const limit = parseInt(url.searchParams.get('limit') ?? '200', 10);

  if (!agentId) return json({ messages: [] });

  try {
    const db = await getDb();
    if (!db) return json({ messages: [] });
    const rows = db
      .prepare(
        `SELECT role, content, run_id, timestamp FROM chat_messages
         WHERE agent_id = ? ORDER BY timestamp ASC LIMIT ?`,
      )
      .all(agentId, limit);
    return json({ messages: rows });
  } catch {
    return json({ messages: [] });
  }
};
