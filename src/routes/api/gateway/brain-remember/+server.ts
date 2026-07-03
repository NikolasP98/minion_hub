import type { RequestHandler } from '@sveltejs/kit';
import { json, error, isHttpError } from '@sveltejs/kit';
import { getCoreDb } from '$server/db/pg-client';
import { resolveAssistantPrincipal } from '$server/auth/assistant-principal';
import { addNote } from '$server/services/brains.service';
import type { CoreCtx } from '$server/auth/core-ctx';

/**
 * POST /api/gateway/brain-remember?agentId=personal-<uuid>[&orgId=<org>]
 *   body: { brainId, title, contentMd }
 *
 * Adds a `note` document to a brain on the agent's behalf (writes need
 * `brains:edit`, on top of the per-brain write-access check inside addNote).
 * The confirm-before-write contract (don't remember without the user's
 * go-ahead) is the gateway tool's job (minion repo, brain-remember-tool.ts) —
 * this endpoint is a plain, idempotent-per-call write.
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
  const { principalId, orgId, capabilities } = await resolveAssistantPrincipal(locals, url);
  if (!capabilities.can('brains', 'edit')) {
    return json({ error: 'Your role does not permit writing to this organization’s brains.' }, { status: 403 });
  }
  const ctx: CoreCtx = { db: getCoreDb(), tenantId: orgId, profileId: principalId };
  const agentId = url.searchParams.get('agentId');

  const body = (await request.json().catch(() => ({}))) as {
    brainId?: unknown;
    title?: unknown;
    contentMd?: unknown;
  };
  const brainId = typeof body.brainId === 'string' ? body.brainId : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const contentMd = typeof body.contentMd === 'string' ? body.contentMd : '';
  if (!brainId || !title || !contentMd.trim()) {
    throw error(400, 'brainId, title, and contentMd are required');
  }

  const actor = { id: principalId, name: agentId };
  try {
    const doc = await addNote(ctx, brainId, title, contentMd, { profileId: principalId, agentId, roles: capabilities.roles }, actor);
    return json({ orgId, document: doc }, { status: 201 });
  } catch (e) {
    if (isHttpError(e)) return json({ error: e.body.message }, { status: e.status });
    const message = e instanceof Error ? e.message : 'remember failed';
    return json({ error: message }, { status: 400 });
  }
};
