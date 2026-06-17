import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { getSource, upsertSource } from '$server/services/finance.service';

export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const provider = url.searchParams.get('provider') ?? 'susii';
  const source = await getSource(ctx, provider);
  // Never leak secret values — secretRefs holds NAMES only, safe to return.
  return json({ source });
};

export const PUT: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await request.json().catch(() => ({}));
  const provider = typeof body.provider === 'string' ? body.provider : 'susii';
  await upsertSource(ctx, provider, {
    config: (body.config ?? {}) as Record<string, unknown>,
    secretRefs: (body.secretRefs ?? {}) as Record<string, string>,
    enabled: body.enabled !== false,
  });
  return json({ ok: true });
};
