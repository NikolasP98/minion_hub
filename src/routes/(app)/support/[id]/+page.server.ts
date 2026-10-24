import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import { ownerFilter } from '$server/services/rbac.service';
import { getIssue, agreementStatus } from '$server/services/support.service';
import { listEntityTimeline } from '$server/services/activity.service';
import { transitionsFor } from '$server/services/workflow.service';
import { uuidParamOr404 } from '$server/utils/uuid-param';

export const load: PageServerLoad = async ({ locals, params, depends }) => {
  uuidParamOr404(params.id);
  const ctx = await datasetCtx(locals, 'support');
  if (isDenied(ctx)) return { support: ctx }; // rendered by DataSource (spec 039)
  depends('support:issue');

  // if-owner scope: a scoped caller only opens tickets they own (else 404).
  const issue = await getIssue(ctx, params.id, await ownerFilter(locals, 'support'));
  if (!issue) throw error(404, 'Ticket not found');
  const [timeline, transitions] = await Promise.all([
    listEntityTimeline(ctx, 'support_issue', params.id),
    transitionsFor(ctx, 'support_issue', params.id, {
      id: locals.user?.supabaseId ?? null,
      name: locals.user?.displayName ?? locals.user?.email ?? null,
      role: locals.user?.role ?? null,
    }),
  ]);
  return { support: { issue, sla: agreementStatus(issue, new Date()), timeline, transitions } };
};
