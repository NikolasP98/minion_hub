import type { RequestHandler } from '@sveltejs/kit';
import { json, isHttpError } from '@sveltejs/kit';
import { getCoreDb } from '$server/db/pg-client';
import { resolveAssistantPrincipal } from '$server/auth/assistant-principal';
import { conversationThemes } from '$server/services/crm-conversation-analysis.service';
import type { CoreCtx } from '$server/auth/core-ctx';

/**
 * POST /api/gateway/crm-conversation-themes?agentId=personal-<uuid>[&orgId=<org>]
 *   body: { channel?, since? }
 *
 * Aggregate rollup over `crm_conversation_analysis` (spec 2026-07-17 §2 WP-B)
 * — top pain points, intent distribution, over-answered rate. Answers CENSUS
 * questions ("are we over-explaining vs. what customers ask for?"); see
 * search-crm-conversations for targeted retrieval.
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
  const { principalId, orgId, capabilities } = await resolveAssistantPrincipal(locals, url);
  if (!capabilities.can('crm', 'view')) {
    return json({ error: 'Your role does not permit reading this organization’s CRM data.' }, { status: 403 });
  }
  const ctx: CoreCtx = { db: getCoreDb(), tenantId: orgId, profileId: principalId };

  const body = (await request.json().catch(() => ({}))) as { channel?: unknown; since?: unknown };
  const channel = typeof body.channel === 'string' && body.channel ? body.channel : undefined;
  const since = typeof body.since === 'string' && body.since ? body.since : undefined;

  try {
    const themes = await conversationThemes(ctx, { channel, since });
    return json({ orgId, ...themes });
  } catch (e) {
    if (isHttpError(e)) return json({ error: e.body.message }, { status: e.status });
    const message = e instanceof Error ? e.message : 'themes query failed';
    return json({ error: message }, { status: 400 });
  }
};
