import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { requireOrgCapability } from '$server/services/rbac.service';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { listElements, upsertElement } from '$server/sandbox/sandbox.service';
import { parseSandboxBody, sandboxErrorResponse } from '../_errors';

/**
 * Element CRUD (spec 010 FR-007). Admin-only in the POC — these rows ARE
 * executable code for everyone who opens the page, so authoring is the
 * privileged act, not reading. `/api/sandbox` is also in `API_WRITE_PREFIXES`
 * (rbac.service) so the central write guard fires even if `requireAdmin` here
 * is ever relaxed.
 */
const postSchema = z.object({
  page: z.string().min(1).max(100).optional(),
  title: z.string().min(1).max(200),
  html: z.string().optional(),
  css: z.string().optional(),
  js: z.string().optional(),
  w: z.number().int().min(1).max(4).optional(),
  h: z.number().int().min(1).max(4).optional(),
});

/** GET /api/sandbox/elements?page= */
export const GET: RequestHandler = async ({ locals, url }) => {
  await requireOrgCapability(locals, 'settings', 'manage');
  const ctx = await requireCoreCtx(locals);
  const page = url.searchParams.get('page') || 'default';
  return json({ elements: await listElements(ctx, page) });
};

/** POST /api/sandbox/elements */
export const POST: RequestHandler = async ({ locals, request }) => {
  await requireOrgCapability(locals, 'settings', 'manage');
  const ctx = await requireCoreCtx(locals);
  try {
    const body = await parseSandboxBody(request, postSchema);
    return json({ element: await upsertElement(ctx, body) }, { status: 201 });
  } catch (failure) {
    return sandboxErrorResponse(failure);
  }
};
