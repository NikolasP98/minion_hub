import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { ownerFilter } from '$server/services/rbac.service';
import { getIssue, updateIssue, PRIORITIES } from '$server/services/support.service';
import { statusChangeBlocked } from '$server/services/workflow.service';
import { StaleWriteError } from '$server/services/errors';

export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const issue = await getIssue(ctx, params.id!, await ownerFilter(locals, 'support'));
  if (!issue) throw error(404);
  return json(issue);
};

// Mirrors IssueStatus in support.service.ts.
const patchSchema = z.object({
  subject: z.string().trim().min(1).max(500).optional(),
  description: z.string().max(20_000).nullable().optional(),
  status: z.enum(['open', 'replied', 'on_hold', 'resolved', 'closed']).optional(),
  priority: z.enum(PRIORITIES).optional(),
  ownerId: z.string().max(200).nullable().optional(),
  expectedUpdatedAt: z.coerce.date().optional(),
});

/** PATCH /api/support/issues/:id — status/priority/owner/subject changes.
 *  Status transitions stamp SLA timers server-side (see updateIssue). */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, patchSchema);
  const actor = { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null };
  // Workflow enforcement — only gates explicit status changes; inert until an
  // admin enables a support_issue workflow.
  if (body.status && (await statusChangeBlocked(ctx, 'support_issue', params.id!, body.status, { ...actor, role: locals.user?.role ?? null })))
    throw error(409, 'status change not permitted by workflow');
  try {
    const issue = await updateIssue(ctx, params.id!, body, actor, body.expectedUpdatedAt);
    if (!issue) throw error(404);
    return json(issue);
  } catch (e) {
    if (e instanceof StaleWriteError) return json({ error: 'stale', current: e.current }, { status: 409 });
    throw e;
  }
};
