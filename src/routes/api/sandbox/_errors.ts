import { json } from '@sveltejs/kit';
import type { z } from 'zod';
import { SandboxQueryError } from '$server/sandbox/query-compiler';

/**
 * Leading underscore = a shared helper, not a SvelteKit route module (same
 * convention as `api/pos/_errors.ts`). The sandbox wire contract is
 * `{ error, field }` with the compiler's own 400/403 status, so these RETURN a
 * Response the handler must `return` — a thrown plain Response becomes a 500.
 *
 * Body-shape failures are reported through the SAME class, so the iframe
 * bridge only ever has to read one error shape.
 */
export async function parseSandboxBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new SandboxQueryError('invalid JSON body', 'body');
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.join('.') || 'body';
    throw new SandboxQueryError(`invalid ${path}: ${issue?.message ?? 'bad request'}`, path);
  }
  return result.data;
}

/** Map a SandboxQueryError to its response; rethrow anything else (incl. the
 *  SvelteKit 401/403/404 HttpErrors thrown by the auth helpers). */
export function sandboxErrorResponse(failure: unknown): Response {
  if (failure instanceof SandboxQueryError) {
    return json({ error: failure.message, field: failure.field }, { status: failure.status });
  }
  throw failure;
}
