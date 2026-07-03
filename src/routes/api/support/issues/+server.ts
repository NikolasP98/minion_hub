import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { ownerFilter } from '$server/services/rbac.service';
import { isModuleEnabled } from '$server/services/modules.service';
import { listIssues, createIssue, PRIORITIES, type IssueFilters, type Priority } from '$server/services/support.service';

/** GET /api/support/issues?status=&priority=&contact= — list tickets. */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'support'))) throw error(404);
  const f: IssueFilters = {
    status: (url.searchParams.get('status') as IssueFilters['status']) ?? undefined,
    priority: (url.searchParams.get('priority') as Priority) ?? undefined,
    crmContactId: url.searchParams.get('contact') ?? undefined,
    ownerId: await ownerFilter(locals, 'support'),
  };
  return json(await listIssues(ctx, f));
};

const postSchema = z.object({
  subject: z.string().trim().min(1).max(500),
  description: z.string().max(20_000).nullable().optional(),
  priority: z.enum(PRIORITIES).optional(),
  crmContactId: z.string().max(200).nullable().optional(),
  partyId: z.string().max(200).nullable().optional(),
  ownerId: z.string().max(200).nullable().optional(),
  source: z.string().max(100).optional(),
  channel: z.string().max(100).nullable().optional(),
});

/** POST /api/support/issues — create a ticket (SLA deadlines stamped server-side). */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'support'))) throw error(404);
  const body = await parseBody(request, postSchema);
  const issue = await createIssue(ctx, {
    subject: body.subject,
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
