import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { insertCredentialHealthSnapshot } from '$server/services/credential-health.service';
import { requireAuth, requireTenantCtx } from '$server/auth/authorize';
import { resolveReliabilityReadTarget } from '$server/services/reliability-read-authority';
import { parseCredentialHealthReadQuery } from '$server/services/reliability-read-query';
import { withReliabilityReadAdmission } from '$server/services/reliability-read-admission';
import {
  boundedReliabilityJson,
  throwReliabilityReadHttpError,
} from '$server/services/reliability-read-response';
import { withOwnedTelemetryRead } from '$server/services/reliability-telemetry-read';
import { readCredentialHealthSnapshots } from '$server/services/reliability-credential-read';

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.tenantCtx) throw error(401, 'Unauthorized');

  const serverId = (locals as Record<string, unknown>).serverId as string | undefined;
  if (!serverId) throw error(401, 'Server identity required');

  const body = await request.json();
  if (!body.snapshotJson || !body.capturedAt) {
    throw error(400, 'Missing snapshotJson or capturedAt');
  }

  await insertCredentialHealthSnapshot(locals.tenantCtx, {
    serverId,
    snapshotJson:
      typeof body.snapshotJson === 'string' ? body.snapshotJson : JSON.stringify(body.snapshotJson),
    capturedAt: body.capturedAt,
  });

  return json({ ok: true });
};

export const GET: RequestHandler = async ({ locals, url }) => {
  try {
    const query = parseCredentialHealthReadQuery(url);
    const user = requireAuth(locals);
    const snapshots = await withReliabilityReadAdmission(
      JSON.stringify(['requested', user.supabaseId ?? null, locals.orgId ?? null, query.serverId]),
      async (signal, rekey) => {
        const target = await resolveReliabilityReadTarget({
          profileId: user.supabaseId ?? null,
          orgId: locals.orgId ?? null,
          serverId: query.serverId,
        });
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        rekey(JSON.stringify(['target', target.profileId, target.gatewayId]));
        return withOwnedTelemetryRead(signal, (tx) =>
          readCredentialHealthSnapshots(tx, target.legacyServerId, query),
        );
      },
    );
    return boundedReliabilityJson({ snapshots });
  } catch (caught) {
    throwReliabilityReadHttpError(caught);
  }
};
