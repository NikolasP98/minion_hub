import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { getProject, githubRepoOf } from '$server/services/projects.service';
import {
  listBranches,
  listCommits,
  listPulls,
  getRepoMeta,
} from '$server/services/github-repos.service';
import { previewsForRepo, previewRunnerConfigured } from '$server/services/preview-runner.service';
import { hasGitHubToken } from '$server/services/github-api';
import { uuidParamOr404 } from '$server/utils/uuid-param';

/**
 * Repo tab for a project.
 *
 * EVERY external read here returns `{ok,reason}` rather than throwing: an
 * unguarded await in a load 500s the whole route subtree, and GitHub being
 * rate-limited must not take the page down. The only `throw` is the project
 * lookup itself.
 */
export const load: PageServerLoad = async ({ locals, params, url, depends }) => {
  uuidParamOr404(params.id);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('projects:repo');

  const project = await getProject(ctx, params.id);
  if (!project) throw error(404, 'Project not found');

  const ref = githubRepoOf(project);
  const githubConfigured = hasGitHubToken();

  if (!ref) {
    return {
      project,
      repo: null,
      githubConfigured,
      previewRunner: previewRunnerConfigured(),
      meta: null,
      branches: null,
      pulls: null,
      commits: null,
      previews: { previews: [], available: false, reason: null as string | null },
      selectedBranch: null,
    };
  }

  const selectedBranch = url.searchParams.get('branch') || ref.defaultBranch || null;

  const [meta, branches, pulls, commits, previews] = await Promise.all([
    getRepoMeta(ctx.tenantId, ref),
    listBranches(ctx.tenantId, ref),
    listPulls(ctx.tenantId, ref),
    listCommits(ctx.tenantId, ref, selectedBranch),
    previewsForRepo(`${ref.owner}/${ref.repo}`),
  ]);

  return {
    project,
    repo: ref,
    githubConfigured,
    previewRunner: previewRunnerConfigured(),
    meta,
    branches,
    pulls,
    commits,
    previews,
    selectedBranch,
  };
};
