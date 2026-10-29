import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireAuth } from '$server/auth/authorize';
import {
  canonicalPage,
  classifyAssistantTurnWithEvidence,
} from '$server/services/assistant-router.service';
import { captureServerEvent } from '$lib/server/posthog';
import { canonicalUuid } from '$lib/assistant/turn-router';
import { distinctIdFor, requestIdentity } from '$lib/server/observability-context';
import { requireFeature } from '$server/services/entitlements.service';

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
  await requireFeature(locals, 'ai.chat');
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

  const candidateId = request.headers.get('x-minion-run-id');
  const submissionId = canonicalUuid(candidateId) ? candidateId : undefined;
  const { decision, attempt } = await classifyAssistantTurnWithEvidence(
    { text, locale, page: pageRoute, submissionId },
    { apiKey: env.OPENROUTER_API_KEY ?? '' },
  );

  // The raw material for threshold calibration. The user's text NEVER ships —
  // only the mode, the probabilities it produced, latency and cost.
  const identity = requestIdentity({
    routeId: route.id,
    method: 'POST',
    headers: {
      get: (name) =>
        name.toLowerCase() === 'x-minion-run-id'
          ? (submissionId ?? null)
          : request.headers.get(name),
    },
    locals,
  });
  if (attempt)
    captureServerEvent({
      event: 'assistant_route',
      distinctId: distinctIdFor(identity),
      properties: {
        ...identity,
        assistant_mode: decision?.mode ?? 'unavailable',
        assistant_cost_usd: attempt.cost.usd,
        cost_status: attempt.cost.status,
        attempt_id: attempt.attemptId,
        ...(attempt.submissionId ? { submission_id: attempt.submissionId } : {}),
        requested_model: attempt.requestedModel,
        resolved_model: attempt.resolvedModel,
        schema_revision: attempt.schemaRevision,
        question_revision: attempt.questionRevision,
        gate_revision: attempt.gateRevision,
        elapsed_ms: attempt.elapsedMs,
        duration_ms: attempt.elapsedMs,
        server_deadline_ms: attempt.serverDeadlineMs,
        attempt_disposition: attempt.disposition,
        input_tokens: attempt.inputTokens,
        output_tokens: attempt.outputTokens,
        ...(decision?.probabilities[decision.mode] === undefined
          ? {}
          : { p_mode: decision.probabilities[decision.mode] }),
        ...Object.fromEntries(
          Object.entries(decision?.manifests ?? {}).map(([id, value]) => [`p_${id}`, value]),
        ),
      },
    });

  return json({ decision, attempt });
};
