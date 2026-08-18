import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { getProject, githubRepoOf } from '$server/services/projects.service';
import {
  startPreview,
  stopPreview,
  previewsForRepo,
} from '$server/services/preview-runner.service';
import { requireOrgCapability } from '$server/services/rbac.service';

/**
 * Start / stop a preview dev server for the project's linked repo.
 *
 * The hub never picks the command or the port — it names a repo and a branch,
 * and the runner (which owns the allowlist and the box) decides the rest.
 * Spec: specs/2026-08-07-projects-github-repos-and-factory-gates-spec.md §3b
 */
const startSchema = z.object({
  branch: z.string().min(1).max(250),
  exposure: z.enum(['tailnet', 'public']).default('tailnet'),
});

const stopSchema = z.object({ previewId: z.string().min(1).max(200) });

function failure(reason: string, detail?: string): never {
  const message =
    reason === 'not_configured'
      ? 'No preview runner is configured for this deployment'
      : reason === 'unreachable'
        ? 'The preview runner is not responding'
        : reason === 'rejected'
          ? detail || 'The preview runner refused the request'
          : 'The preview runner failed';
  throw error(reason === 'rejected' ? 400 : 502, message);
}

/** POST /api/projects/:id/preview — start (or return the existing) preview. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const project = await getProject(ctx, params.id!);
  if (!project) throw error(404);
  const ref = githubRepoOf(project);
  if (!ref) throw error(409, 'This project has no linked repository');

  const body = await parseBody(request, startSchema);
  // Publishing a dev server to the open internet is a deliberate, higher-privilege
  // act than starting one on the tailnet — never a default, never the same gate.
  if (body.exposure === 'public') await requireOrgCapability(locals, 'projects', 'manage');

  const res = await startPreview({
    repo: `${ref.owner}/${ref.repo}`,
    branch: body.branch,
    exposure: body.exposure,
  });
  if (!res.ok) failure(res.reason, res.detail);
  return json(res.data);
};

/** DELETE /api/projects/:id/preview — stop one. */
export const DELETE: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const project = await getProject(ctx, params.id!);
  if (!project) throw error(404);
  const ref = githubRepoOf(project);
  if (!ref) throw error(409, 'This project has no linked repository');

  const body = await parseBody(request, stopSchema);

  // The preview id is a runner-global handle, NOT scoped to this project — so
  // it must be proved to belong to THIS project's repo before we act on it.
  // Without this, any member of any org could stop another org's preview by id.
  // 404 (not 403) so a wrong id leaks nothing about what exists.
  const owned = await previewsForRepo(`${ref.owner}/${ref.repo}`);
  if (!owned.available) failure(owned.reason ?? 'error');
  if (!owned.previews.some((p) => p.id === body.previewId)) throw error(404);

  const res = await stopPreview(body.previewId);
  if (!res.ok) failure(res.reason, res.detail);
  return json({ ok: true });
};
