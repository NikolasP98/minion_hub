import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { checkDecisionEventRateLimit } from '$server/auth/rate-limit';
import { isSelfOnlyObservation } from '$server/services/rbac.service';
import {
  EVENT_NAMES,
  observationProperties,
  validateDecisionEvent,
} from '$lib/assistant/decision-lineage';
import { captureServerEvent } from '$lib/server/posthog';
import { distinctIdFor, requestIdentity } from '$lib/server/observability-context';

export const POST: RequestHandler = async ({ locals, request, url, route }) => {
  requireAuth(locals);
  const ctx = await requireCoreCtx(locals);
  if (!ctx.tenantId || !locals.user?.id) error(401, 'Authentication required');
  if (!isSelfOnlyObservation('/api/assistant/decision-events', 'POST')) error(403, 'Forbidden');
  if (
    request.headers.get('origin') !== url.origin ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  )
    error(403, 'Origin required');
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? ''))
    error(415, 'JSON required');
  const reader = request.body?.getReader();
  if (!reader) error(400, 'Body required');
  let bytes = 0,
    raw = '';
  const decoder = new TextDecoder();
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > 16_384) {
      await reader.cancel();
      error(413, 'Batch too large');
    }
    raw += decoder.decode(chunk.value, { stream: true });
  }
  raw += decoder.decode();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    error(400, 'Invalid JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) error(400, 'Invalid batch');
  const input = body as Record<string, unknown>;
  if (
    Object.keys(input).some((k) => !['version', 'events'].includes(k)) ||
    input.version !== 1 ||
    !Array.isArray(input.events) ||
    !input.events.length ||
    input.events.length > 20
  )
    error(400, 'Invalid batch');
  const events = input.events.map(validateDecisionEvent);
  if (events.some((e) => !e)) error(400, 'Invalid observation');
  if (!checkDecisionEventRateLimit(`${locals.user.id}\0${ctx.tenantId}`, events.length))
    error(429, 'Observation limit exceeded');
  // Identity is resolved here; forged payload identity is never spread into capture.
  const identity = requestIdentity({
    routeId: route.id,
    method: 'POST',
    headers: request.headers,
    locals: { ...locals, orgId: ctx.tenantId },
  });
  for (const event of events)
    if (event)
      captureServerEvent({
        event: EVENT_NAMES[event.kind],
        distinctId: distinctIdFor(identity),
        properties: { ...observationProperties(event), ...identity },
      });
  return json({ accepted: events.length });
};
