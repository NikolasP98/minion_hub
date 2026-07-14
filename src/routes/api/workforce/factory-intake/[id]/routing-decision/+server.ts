import { error, json } from '@sveltejs/kit';
import { trustedWorkforceMutationHeaders, workforceRawFetch } from '$lib/server/workforce-fetch';
import { normalizeFactoryScopes } from '$lib/workforce/factory-intake';
import type { RequestHandler } from './$types';

function text(value: unknown, max = 4000): string | null {
  return typeof value === 'string' && value.trim() && value.trim().length <= max
    ? value.trim()
    : null;
}

function uuid(value: unknown): string | null {
  const candidate = text(value, 36);
  return candidate &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : null;
}

export const POST: RequestHandler = async (event) => {
  if (!event.locals.user) throw error(401, 'Authentication required');
  if (!event.locals.workforceIdentity) {
    return json({ error: 'The factory control plane is unavailable.' }, { status: 503 });
  }
  const body = (await event.request.json().catch(() => null)) as Record<string, unknown> | null;
  const decision =
    body?.decision && typeof body.decision === 'object' && !Array.isArray(body.decision)
      ? (body.decision as Record<string, unknown>)
      : null;
  const kind = text(decision?.kind, 40);
  let safeDecision: Record<string, unknown>;

  if (kind === 'existing_project') {
    const projectId = uuid(decision?.projectId);
    if (!projectId) throw error(400, 'projectId is required');
    safeDecision = { kind, projectId };
  } else if (kind === 'new_project') {
    const name = text(decision?.name, 160);
    const repositoryKey = text(decision?.repositoryKey, 120);
    if (!name || !repositoryKey) throw error(400, 'name and repositoryKey are required');
    const scopes = normalizeFactoryScopes(decision?.scopes);
    safeDecision = {
      kind,
      name,
      description: text(decision?.description, 2000),
      repositoryKey,
      scopes,
      ...(text(decision?.groupKey, 120) ? { groupKey: text(decision?.groupKey, 120) } : {}),
    };
  } else if (kind === 'reject') {
    safeDecision = { kind };
  } else {
    throw error(400, 'invalid routing decision');
  }

  try {
    const result = await workforceRawFetch<unknown>(
      event,
      `/api/factory-intakes/${encodeURIComponent(event.params.id)}/routing-decision`,
      {
        method: 'POST',
        headers: trustedWorkforceMutationHeaders(),
        body: JSON.stringify({ decision: safeDecision, note: text(body?.note, 4000) }),
      },
    );
    return json(result);
  } catch (cause) {
    console.warn('[factory-intake] routing decision failed', cause);
    const status = (cause as { status?: number })?.status;
    return json(
      { error: 'The routing decision could not be recorded.' },
      { status: status && status >= 400 && status < 500 ? status : 502 },
    );
  }
};
