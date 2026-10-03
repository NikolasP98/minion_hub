import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { insertSkillStats, readAuthorizedSkillStats } from '$server/services/skill-stats.service';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAuth } from '$server/auth/authorize';
import { getCoreDb } from '$server/db/pg-client';
import { resolveReliabilityReadTarget } from '$server/services/reliability-read-authority';
import { parseSkillStatsReadQuery } from '$server/services/reliability-read-query';
import { withReliabilityReadAdmission } from '$server/services/reliability-read-admission';
import {
  boundedReliabilityJson,
  throwReliabilityReadHttpError,
} from '$server/services/reliability-read-response';

export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Unauthorized');

  const serverId = (locals as Record<string, unknown>).serverId as string | undefined;
  if (!serverId) throw error(401, 'Server identity required');

  const body = await request.json();
  const stats = Array.isArray(body.stats) ? body.stats : [];
  if (stats.length === 0) return json({ ok: true });

  await insertSkillStats(
    ctx,
    stats.map((s: Record<string, unknown>) => ({ ...s, serverId })),
  );

  return json({ ok: true, count: stats.length });
};

export const GET: RequestHandler = async ({ locals, url }) => {
  try {
    const query = parseSkillStatsReadQuery(url);
    const user = requireAuth(locals);
    const result = await withReliabilityReadAdmission(
      JSON.stringify(['requested', user.supabaseId ?? null, locals.orgId ?? null, query.serverId]),
      async (signal, rekey) => {
        const target = await resolveReliabilityReadTarget({
          profileId: user.supabaseId ?? null,
          orgId: locals.orgId ?? null,
          serverId: query.serverId,
        });
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        rekey(JSON.stringify(['target', target.profileId, target.gatewayId]));
        return readAuthorizedSkillStats(
          { db: getCoreDb(), tenantId: target.orgId, profileId: target.profileId },
          target.gatewayId,
          query,
        );
      },
    );
    return boundedReliabilityJson(result);
  } catch (caught) {
    throwReliabilityReadHttpError(caught);
  }
};
