import type { RequestHandler } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { resolveReliabilityReadTarget } from '$server/services/reliability-read-authority';
import { parseInsightsReadQuery } from '$server/services/reliability-read-query';
import { withReliabilityReadAdmission } from '$server/services/reliability-read-admission';
import {
  boundedReliabilityJson,
  throwReliabilityReadHttpError,
} from '$server/services/reliability-read-response';
import { withOwnedTelemetryRead } from '$server/services/reliability-telemetry-read';
import { readReliabilityInsights } from '$server/services/reliability-insights-read';

export const GET: RequestHandler = async ({ locals, url }) => {
  try {
    const query = parseInsightsReadQuery(url);
    const user = requireAuth(locals);
    const insights = await withReliabilityReadAdmission(
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
          readReliabilityInsights(tx, target.legacyServerId, query),
        );
      },
    );
    return boundedReliabilityJson({ insights });
  } catch (caught) {
    throwReliabilityReadHttpError(caught);
  }
};
