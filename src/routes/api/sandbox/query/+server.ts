import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { requireAuth } from '$server/auth/authorize';
import { AGGREGATE_FNS, OPS } from '$server/sandbox/query-compiler';
import { runQuery } from '$server/sandbox/sandbox.service';
import { parseSandboxBody, sandboxErrorResponse } from '../_errors';

/**
 * The one configurable read endpoint behind sandbox elements (spec 010 FR-003,
 * contract §1). `requireAuth` only establishes WHO is asking — the dataset's
 * own RBAC module `view` capability, record-level owner scope, PII masking and
 * RLS are all applied by `runQuery`, so this route adds no authority of its
 * own and is safe for non-admin members in a later slice.
 */
const specSchema = z.object({
  dataset: z.string().min(1).max(100),
  select: z.array(z.string().max(100)).max(50).optional(),
  where: z
    .array(z.object({ col: z.string().max(100), op: z.enum(OPS), value: z.unknown().optional() }))
    .max(20)
    .optional(),
  orderBy: z
    .array(z.object({ col: z.string().max(100), dir: z.enum(['asc', 'desc']).optional() }))
    .max(5)
    .optional(),
  limit: z.number().finite().optional(),
  groupBy: z.array(z.string().max(100)).max(5).optional(),
  aggregate: z
    .array(
      z.object({
        fn: z.enum(AGGREGATE_FNS),
        col: z.string().max(100),
        as: z.string().max(60),
      }),
    )
    .max(10)
    .optional(),
});

/** POST /api/sandbox/query */
export const POST: RequestHandler = async ({ locals, request }) => {
  requireAuth(locals);
  try {
    const spec = await parseSandboxBody(request, specSchema);
    return json(await runQuery(locals, spec));
  } catch (failure) {
    return sandboxErrorResponse(failure);
  }
};
