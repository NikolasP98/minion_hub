import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { listIssues, createIssue, type IssueFilters, type Priority } from '$server/services/support.service';

/** GET /api/support/issues?status=&priority=&contact= — list tickets. */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'support'))) throw error(404);
  const f: IssueFilters = {
    status: (url.searchParams.get('status') as IssueFilters['status']) ?? undefined,
    priority: (url.searchParams.get('priority') as Priority) ?? undefined,
    crmContactId: url.searchParams.get('contact') ?? undefined,
  };
  return json(await listIssues(ctx, f));
};

/** POST /api/support/issues — create a ticket (SLA deadlines stamped server-side). */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'support'))) throw error(404);
  const body = await request.json();
  if (!body?.subject?.trim()) throw error(400, 'subject required');
  const issue = await createIssue(ctx, {
    subject: String(body.subject).trim(),
    description: body.description ?? null,
    priority: body.priority,
    crmContactId: body.crmContactId ?? null,
    partyId: body.partyId ?? null,
    ownerId: body.ownerId ?? null,
    source: body.source,
    channel: body.channel ?? null,
  });
  return json(issue, { status: 201 });
};
