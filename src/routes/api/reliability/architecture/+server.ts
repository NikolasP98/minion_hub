import type { RequestHandler } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { probeArchitecture } from '$server/services/architecture.service';
import { requireFreshReliabilityMember } from '$server/services/reliability-read-authority';
import { parseArchitectureReadQuery } from '$server/services/reliability-read-query';
import { withReliabilityReadAdmission } from '$server/services/reliability-read-admission';
import {
  boundedReliabilityJson,
  throwReliabilityReadHttpError,
} from '$server/services/reliability-read-response';

export const GET: RequestHandler = async ({ locals, url }) => {
  try {
    parseArchitectureReadQuery(url);
    const user = requireAuth(locals);
    const snapshot = await withReliabilityReadAdmission(
      JSON.stringify(['organization', user.supabaseId ?? null, locals.orgId ?? null]),
      async (signal) => {
        const authority = await requireFreshReliabilityMember({
          profileId: user.supabaseId ?? null,
          orgId: locals.orgId ?? null,
        });
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        return probeArchitecture(authority.orgId, signal);
      },
    );
    return boundedReliabilityJson(snapshot);
  } catch (caught) {
    throwReliabilityReadHttpError(caught);
  }
};
