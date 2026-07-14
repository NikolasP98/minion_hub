import { error, json } from '@sveltejs/kit';
import { trustedWorkforceMutationHeaders, workforceRawFetch } from '$lib/server/workforce-fetch';
import type { RequestHandler } from './$types';

const MAX_REQUEST_LENGTH = 12_000;

function safeRoute(value: unknown): string {
  if (typeof value !== 'string') return '/workforce';
  const route = value.trim();
  return route.startsWith('/') && !route.startsWith('//') && !route.startsWith('/\\')
    ? route.slice(0, 500)
    : '/workforce';
}

function safeOptionalId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const id = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ? id
    : undefined;
}

function safeIdempotencyKey(value: unknown): string {
  if (typeof value === 'string' && /^[a-zA-Z0-9:_-]{8,128}$/.test(value)) return value;
  return crypto.randomUUID();
}

export const POST: RequestHandler = async (event) => {
  if (!event.locals.user) throw error(401, 'Authentication required');
  if (!event.locals.workforceIdentity) {
    return json(
      { error: 'The factory control plane is unavailable.', code: 'workforce_unavailable' },
      { status: 503 },
    );
  }
  const companyId = event.locals.orgId ?? event.locals.tenantCtx?.tenantId ?? null;
  if (!companyId) throw error(409, 'Select an organization before creating factory work.');

  const body = (await event.request.json().catch(() => null)) as Record<string, unknown> | null;
  const request = typeof body?.request === 'string' ? body.request.trim() : '';
  if (!request || request.length > MAX_REQUEST_LENGTH) {
    throw error(400, `request must be between 1 and ${MAX_REQUEST_LENGTH} characters`);
  }
  const source =
    body?.source && typeof body.source === 'object' && !Array.isArray(body.source)
      ? (body.source as Record<string, unknown>)
      : {};

  try {
    const result = await workforceRawFetch<unknown>(
      event,
      `/api/companies/${encodeURIComponent(companyId)}/factory-intakes`,
      {
        method: 'POST',
        headers: trustedWorkforceMutationHeaders(),
        body: JSON.stringify({
          request,
          source: {
            kind: 'hub_assistant',
            route: safeRoute(source.route),
            selectedAgentId: safeOptionalId(source.selectedAgentId),
          },
          idempotencyKey: safeIdempotencyKey(body?.idempotencyKey),
          // Exact-user is deliberate: the backend resolves the signed actor.
          // Client-supplied company/user/routing authority is never forwarded.
          routingTarget: { type: 'user' },
        }),
      },
    );
    return json(result, { status: 202 });
  } catch (cause) {
    console.warn('[factory-intake] Workforce request failed', cause);
    const status = (cause as { status?: number })?.status;
    return json(
      { error: 'The factory control plane is unavailable.', code: 'workforce_unavailable' },
      { status: status && status >= 400 && status < 500 ? status : 502 },
    );
  }
};
