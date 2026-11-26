import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { requireOrgCapability } from '$server/services/rbac.service';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { removeElement, setListens, upsertElement } from '$server/sandbox/sandbox.service';
import { SandboxQueryError } from '$server/sandbox/query-compiler';
import { listensSchema, type BlockSpec } from '$lib/sandbox/blocks/schema';
import { validateBlockSpec } from '$server/sandbox/blocks';
import { parseSandboxBody, sandboxErrorResponse } from '../../_errors';

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  html: z.string().optional(),
  css: z.string().optional(),
  js: z.string().optional(),
  spec: z.unknown().optional(),
  /** Connections only (spec 150): replaces the block's `listens`, `[]` clears; overrides `spec.listens`. */
  listens: listensSchema.optional(),
  w: z.number().int().min(1).max(4).optional(),
  h: z.number().int().min(1).max(4).optional(),
  position: z.number().int().min(0).max(10_000).optional(),
  published: z.boolean().optional(),
});

/** PATCH /api/sandbox/elements/[id] */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  await requireOrgCapability(locals, 'settings', 'manage');
  const ctx = await requireCoreCtx(locals);
  try {
    const { spec, listens, ...body } = await parseSandboxBody(request, patchSchema);
    let validated: BlockSpec | undefined;
    if (spec !== undefined) {
      // The body's `listens` overrides the spec's own, and is checked with the spec.
      const raw =
        listens !== undefined && spec && typeof spec === 'object' ? { ...spec, listens } : spec;
      validated = validateBlockSpec(raw);
      if (listens !== undefined && validated.type === 'filter') {
        throw new SandboxQueryError('a filter takes no connections', 'listens');
      }
    }
    if (listens !== undefined && spec === undefined) {
      // Connections alone: lock, merge, validate, write (spec 150 FR-009).
      // With other fields it is ONE transaction (nothing is written when either part is refused).
      const element =
        Object.keys(body).length > 0
          ? await upsertElement(ctx, { ...body, id: params.id, listens })
          : await setListens(ctx, params.id!, listens);
      return json({ element });
    }
    const element = await upsertElement(ctx, {
      ...body,
      ...(validated ? { spec: validated } : {}),
      id: params.id,
    });
    return json({ element });
  } catch (failure) {
    return sandboxErrorResponse(failure);
  }
};

/** DELETE /api/sandbox/elements/[id] */
export const DELETE: RequestHandler = async ({ locals, params }) => {
  await requireOrgCapability(locals, 'settings', 'manage');
  const ctx = await requireCoreCtx(locals);
  try {
    if (!(await removeElement(ctx, params.id!))) throw error(404, 'element not found');
    return json({ ok: true });
  } catch (failure) {
    return sandboxErrorResponse(failure);
  }
};
