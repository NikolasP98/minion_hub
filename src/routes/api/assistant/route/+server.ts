import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireAuth } from '$server/auth/authorize';
import { canonicalPage, classifyAssistantTurn } from '$server/services/assistant-router.service';
import { captureServerEvent } from '$lib/server/posthog';
import { distinctIdFor, requestIdentity } from '$lib/server/observability-context';

/**
 * POST /api/assistant/route — classify ONE assistant turn so the client can
 * send only the context manifests the turn actually needs instead of the full
 * ~4.3K-token envelope (see `$lib/assistant/turn-router`).
 *
 * Body: `{ text, locale, page }` (`page` = the canonical route the user is on,
 * validated by `canonicalPage` and dropped when it is not a short absolute path). Always HTTP 200: `{ decision }` on success,
 * `{ decision: null }` on a missing key, a timeout or any classifier failure,
 * because a null decision means "send today's full envelope" (fail open). An
 * error status would be indistinguishable from it at the callsite and would
 * show up as a console error on a path the user cannot act on.
 *
 * Auth: `requireAuth` only, deliberately. This reads no org data and writes no
 * org data — it classifies the caller's own typed text — so it is not a
 * business write and carries no module capability (it is not in
 * `API_WRITE_PREFIXES`; see rbac.service.ts `apiWriteCapability`).
 */
export const POST: RequestHandler = async ({ locals, request, route }) => {
  requireAuth(locals);

  const body = (await request.json().catch(() => null)) as {
    text?: unknown;
    locale?: unknown;
    page?: unknown;
  } | null;
  const text = typeof body?.text === 'string' ? body.text : '';
  const locale = typeof body?.locale === 'string' ? body.locale : undefined;
  const pageRoute = canonicalPage(body?.page);
  if (!text.trim()) return json({ decision: null });

  const decision = await classifyAssistantTurn(
    { text, locale, page: pageRoute },
    { apiKey: env.OPENROUTER_API_KEY ?? '' },
  );

  // The raw material for threshold calibration. The user's text NEVER ships —
  // only the mode, the probabilities it produced, latency and cost.
  const identity = requestIdentity({
    routeId: route.id,
    method: 'POST',
    headers: request.headers,
    locals,
  });
  captureServerEvent({
    event: 'assistant_route',
    distinctId: distinctIdFor(identity),
    properties: {
      ...identity,
      assistant_mode: decision?.mode ?? 'unavailable',
      assistant_cost_usd: decision?.cost ?? 0,
      duration_ms: decision?.ms ?? 0,
      p_mode: decision ? (decision.probabilities[decision.mode] ?? 0) : 0,
      p_pages: decision?.manifests.pages ?? 0,
      p_forms: decision?.manifests.forms ?? 0,
      p_data: decision?.manifests.data ?? 0,
      p_brain: decision?.manifests.brain ?? 0,
      p_changelog: decision?.manifests.changelog ?? 0,
      p_sandbox: decision?.manifests.sandbox ?? 0,
    },
  });

  return json({ decision });
};
