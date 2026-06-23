import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { getIssue, updateIssue, type UpdateIssueInput } from '$server/services/support.service';

export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const issue = await getIssue(ctx, params.id!);
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
  const issue = await updateIssue(ctx, params.id!, body, actor);
  if (!issue) throw error(404);
  return json(issue);
};
