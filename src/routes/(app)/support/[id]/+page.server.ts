import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { getIssue, agreementStatus } from '$server/services/support.service';
import { listEntityTimeline } from '$server/services/activity.service';
import { transitionsFor } from '$server/services/workflow.service';

export const load: PageServerLoad = async ({ locals, params, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'support'))) throw error(404, 'Support module disabled');
  depends('support:issue');

  const issue = await getIssue(ctx, params.id);
  if (!issue) throw error(404, 'Ticket not found');
  const [timeline, transitions] = await Promise.all([
    listEntityTimeline(ctx, 'support_issue', params.id),
    transitionsFor(ctx, 'support_issue', params.id, {
      id: locals.user?.supabaseId ?? null,
      name: locals.user?.displayName ?? locals.user?.email ?? null,
      role: locals.user?.role ?? null,
    }),
  ]);
  return { issue, sla: agreementStatus(issue, new Date()), timeline, transitions };
};
