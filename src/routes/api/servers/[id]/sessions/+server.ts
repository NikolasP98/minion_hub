import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { listSessions, upsertSession } from '$server/services/session.service';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { assertCanAccessStoredSession, requireAuth } from '$server/auth/authorize';
import { getPersonalAssistantId } from '$server/services/personal-agent.service';

export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await requireCoreCtx(locals);

  const user = requireAuth(locals);
  const sessions = await listSessions(ctx, params.id!);
  if (user.role === 'admin') return json({ sessions });
  // Spec 117 FR-010: a member sees only their own assistant's sessions.
  const own = user.supabaseId
    ? (await getPersonalAssistantId(user.supabaseId))?.toLowerCase()
    : null;
  return json({ sessions: own ? sessions.filter((s) => s.agentId.toLowerCase() === own) : [] });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await requireCoreCtx(locals);

  const body = await request.json();
  // Spec 117 FR-010: a member files session rows only under their own assistant.
  await assertCanAccessStoredSession(locals, { sessionKey: String(body.sessionKey ?? '') });
  await assertCanAccessStoredSession(locals, { agentId: String(body.agentId ?? '') });
  const id = await upsertSession(ctx, { ...body, serverId: params.id! });
  return json({ ok: true, id });
};
