import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAdmin } from '$server/auth/authorize';
import { parseBody } from '$server/api/validate';
import { getSource, upsertSource, sourceHasCredentials } from '$server/services/finance.service';
import { encryptCreds } from '$server/services/finance-secrets';
import { getConnector } from '$server/finance/connector';
import '$server/finance/connectors/susii-connector';

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

const putSchema = z.object({
  provider: z.string().max(200).optional(),
  username: z.string().max(500).optional(),
  password: z.string().max(500).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

export const PUT: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, putSchema);
  const provider = typeof body.provider === 'string' ? body.provider : 'susii';
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password.trim() : '';

  // Both-or-neither. A half-filled form used to fall into the "preserve
  // existing" branch and return ok:true having changed nothing — so "I updated
  // the password" silently no-op'd and the sync kept failing with the old
  // credential (Aug 2026). Typing one field is always a mistake, never intent.
  if (Boolean(username) !== Boolean(password)) {
    throw error(400, 'provide BOTH username and password, or leave both blank to keep the current credentials');
  }

  // null = no probe ran (nothing to verify). true = the provider accepted these
  // credentials just now. Returned so the UI can confirm auth immediately
  // instead of leaving the user staring at `last_status`, which describes the
  // last SYNC and stays 'failed' until the next run — the exact confusion that
  // made a working credential look broken (Aug 2026).
  let verified: boolean | null = null;

  let secretRefs: Record<string, unknown>;
  if (username && password) {
    // Verify before storing: `count()` performs the provider login, so a bad
    // credential fails here with the provider's own reason instead of being
    // written and only surfacing as a failed job at 08:00 the next morning.
    const connector = getConnector(provider);
    if (connector?.count) {
      try {
        await connector.count({ config: (body.config ?? {}) as Record<string, unknown>, secrets: { username, password } });
        verified = true;
      } catch (e) {
        throw error(400, `provider rejected these credentials: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    secretRefs = encryptCreds({ username, password });
  } else {
    // Both blank — deliberate "keep what's stored" (editing config/enabled only).
    const existing = await getSource(ctx, provider);
    secretRefs = (existing?.secretRefs ?? {}) as Record<string, unknown>;
  }

  await upsertSource(ctx, provider, {
    config: (body.config ?? {}) as Record<string, unknown>,
    secretRefs,
    enabled: body.enabled !== false,
  });
  return json({ ok: true, verified });
};
