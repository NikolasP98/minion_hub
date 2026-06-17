import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAdmin } from '$server/auth/authorize';
import { getSource, upsertSource, sourceHasCredentials } from '$server/services/finance.service';
import { encryptCreds } from '$server/services/finance-secrets';

export const GET: RequestHandler = async ({ locals, url }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const provider = url.searchParams.get('provider') ?? 'susii';
  const source = await getSource(ctx, provider);
  // Never return the raw secret blob to the client.
  return json({
    source: source ? { ...source, secretRefs: undefined, hasCredentials: sourceHasCredentials(source) } : null,
  });
};

export const PUT: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const provider = typeof body.provider === 'string' ? body.provider : 'susii';
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password.trim() : '';

  let secretRefs: Record<string, unknown>;
  if (username && password) {
    secretRefs = encryptCreds({ username, password });
  } else {
    // Preserve existing credentials when the user left the fields blank.
    const existing = await getSource(ctx, provider);
    secretRefs = (existing?.secretRefs ?? {}) as Record<string, unknown>;
  }

  await upsertSource(ctx, provider, {
    config: (body.config ?? {}) as Record<string, unknown>,
    secretRefs,
    enabled: body.enabled !== false,
  });
  return json({ ok: true });
};
