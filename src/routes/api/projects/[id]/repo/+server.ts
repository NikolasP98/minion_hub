import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { getProject, setGithubRepo, githubRepoOf } from '$server/services/projects.service';
import { verifyRepo, bustRepoCache } from '$server/services/github-repos.service';
import { isRepoName } from '$server/services/github-api';

/**
 * Link / unlink a project's GitHub repo.
 *
 * Writes are gated centrally: `/api/projects` is an API_WRITE_PREFIX bound to
 * the `projects` module (rbac.service.ts), so PUT→edit and DELETE→delete are
 * already enforced in hooks.server.ts before this handler runs.
 */
const linkSchema = z.object({
  owner: z.string().min(1).max(100),
  repo: z.string().min(1).max(100),
});

function actorOf(locals: App.Locals, profileId: string | null) {
  return { id: profileId, name: locals.user?.displayName ?? locals.user?.email ?? null };
}

/** PUT /api/projects/:id/repo — validate against GitHub, then persist. */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const project = await getProject(ctx, params.id!);
  if (!project) throw error(404);

  const body = await parseBody(request, linkSchema);
  // Shape-check BEFORE the repo name ever reaches a URL (SSRF guard precedent).
  if (!isRepoName(body.owner, body.repo)) throw error(400, 'Invalid repository name');

  const verified = await verifyRepo({ owner: body.owner, repo: body.repo });
  if (!verified.ok) {
    const message =
      verified.reason === 'not_configured'
        ? 'GitHub is not configured on this deployment'
        : verified.reason === 'not_found'
          ? 'Repository not found, or the token cannot see it'
          : verified.reason === 'rate_limited'
            ? 'GitHub rate limit reached — try again shortly'
            : 'Could not reach GitHub';
    throw error(verified.reason === 'not_found' ? 404 : 502, message);
  }

  const updated = await setGithubRepo(
    ctx,
    params.id!,
    { owner: body.owner, repo: body.repo, defaultBranch: verified.data.defaultBranch },
    actorOf(locals, ctx.profileId ?? null),
  );
  if (!updated) throw error(404);
  return json({ repo: githubRepoOf(updated), meta: verified.data });
};

/** DELETE /api/projects/:id/repo — unlink. */
export const DELETE: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const project = await getProject(ctx, params.id!);
  if (!project) throw error(404);

  const existing = githubRepoOf(project);
  const updated = await setGithubRepo(
    ctx,
    params.id!,
    null,
    actorOf(locals, ctx.profileId ?? null),
  );
  if (!updated) throw error(404);
  if (existing) await bustRepoCache(existing);
  return json({ repo: null });
};
