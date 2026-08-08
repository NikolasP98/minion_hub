import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { getProject, githubRepoOf, createTask } from '$server/services/projects.service';
import { submitReview, bustRepoCache } from '$server/services/github-repos.service';
import { GATE_IDS, nextGate } from '$lib/workforce/factory-gates';

/**
 * Post a gate decision as a REAL GitHub review.
 *
 * Order matters: GitHub first, agent dispatch second. The review is the durable
 * record; a dispatch failure must never leave a decision that exists only in
 * the hub, and a GitHub failure must never dispatch an agent for a decision
 * that was never recorded.
 *
 * Spec: specs/2026-08-07-projects-github-repos-and-factory-gates-spec.md §4.4
 */
const reviewSchema = z.object({
  number: z.number().int().positive(),
  decision: z.enum(['approve', 'request_changes', 'comment']),
  body: z.string().max(4_000).default(''),
  /** Which gate this decision is about — for the dispatch message only. */
  gate: z.enum(GATE_IDS).optional(),
  /** Ask the project's agent to continue after an approval. */
  dispatch: z.boolean().default(false),
});

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const project = await getProject(ctx, params.id!);
  if (!project) throw error(404);

  const ref = githubRepoOf(project);
  if (!ref) throw error(409, 'This project has no linked repository');

  const body = await parseBody(request, reviewSchema);
  const text = body.body.trim();
  // Mirrors buildPipelineGateMutation: a non-approval must say why.
  if (body.decision !== 'approve' && !text) {
    throw error(400, 'A comment is required when requesting changes or commenting');
  }

  const who = locals.user?.displayName ?? locals.user?.email ?? 'a Minion user';
  const result = await submitReview(ref, {
    number: body.number,
    decision: body.decision,
    body: text || 'Approved.',
    attribution: `${who} via Minion`,
  });

  if (!result.ok) {
    const message =
      result.reason === 'not_configured'
        ? 'GitHub is not configured on this deployment'
        : result.reason === 'not_found'
          ? 'Pull request not found'
          : result.reason === 'rate_limited'
            ? 'GitHub rate limit reached — try again shortly'
            : 'GitHub rejected the review';
    throw error(result.reason === 'not_found' ? 404 : 502, message);
  }

  await bustRepoCache(ref);

  // Best-effort continuation. A failed dispatch never invalidates the review —
  // same contract as dispatchToAgent() in projects.service.
  let dispatched = false;
  if (body.dispatch && body.gate) {
    const next = body.decision === 'approve' ? nextGate(body.gate) : body.gate;
    if (next) {
      // createTask dispatches to the gateway by itself when the assignee party
      // is an agent; when the lead is a human it just files the task. Either
      // way the ask is recorded — hence best-effort, never fatal.
      const task = await createTask(
        ctx,
        {
          projectId: project.id,
          title:
            body.decision === 'approve'
              ? `Gate ${body.gate} approved on ${ref.owner}/${ref.repo}#${body.number} — proceed to ${next}`
              : `Changes requested at gate ${body.gate} on ${ref.owner}/${ref.repo}#${body.number}`,
          description: [
            `Pull request: https://github.com/${ref.owner}/${ref.repo}/pull/${body.number}`,
            `Decision: ${body.decision} (by ${who})`,
            '',
            text,
          ].join('\n'),
          status: 'todo',
          priority: 'high',
          assigneePartyId: project.leadPartyId ?? null,
        },
        { id: ctx.profileId ?? null, name: who },
      ).catch(() => null);
      dispatched = !!task;
    }
  }

  return json({ ok: true, reviewId: result.data.id, dispatched });
};
