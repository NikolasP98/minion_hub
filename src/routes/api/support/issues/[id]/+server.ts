import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { ownerFilter } from '$server/services/rbac.service';
import { getIssue, updateIssue, type UpdateIssueInput } from '$server/services/support.service';
import { statusChangeBlocked } from '$server/services/workflow.service';

export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const issue = await getIssue(ctx, params.id!, await ownerFilter(locals, 'support'));
  if (!issue) throw error(404);
  return json(issue);
};

/** PATCH /api/support/issues/:id — status/priority/owner/subject changes.
 *  Status transitions stamp SLA timers server-side (see updateIssue). */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = (await request.json()) as UpdateIssueInput;
  const actor = { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null };
  // Workflow enforcement — only gates explicit status changes; inert until an
  // admin enables a support_issue workflow.
  if (body.status && (await statusChangeBlocked(ctx, 'support_issue', params.id!, body.status, { ...actor, role: locals.user?.role ?? null })))
    throw error(409, 'status change not permitted by workflow');
  const issue = await updateIssue(ctx, params.id!, body, actor);
  if (!issue) throw error(404);
  return json(issue);
};
