import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { requireOrgCapability } from '$server/services/rbac.service';
import { getSource, upsertSource, sourceHasCredentials } from '$server/services/finance.service';
import { encryptCreds } from '$server/services/finance-secrets';
import { getConnector } from '$server/finance/connector';
// Side-effect import registers the susii connector so the save-time probe below
// can reach it. sunat-sire is deliberately NOT registered here: its count() costs
// one live SIRE request per period, which is too slow to run inline on save —
// that provider is verified through the explicit POST /api/finances/sources/probe
// endpoint instead, so getConnector('sunat-sire') stays undefined and no probe runs.
import '$server/finance/connectors/susii-connector';
import { parseSunatSourceConfig } from '$server/finance/connectors/sunat-source';

export const GET: RequestHandler = async ({ locals, url }) => {
  await requireOrgCapability(locals, 'finance', 'view');
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const requestedProvider = url.searchParams.get('provider') ?? 'susii';
  const parsedProvider = z.enum(['susii', 'sunat-sire']).safeParse(requestedProvider);
  if (!parsedProvider.success) throw error(400, 'Unsupported finance source provider.');
  const provider = parsedProvider.data;
  const source = await getSource(ctx, provider);
  // Never return the raw secret blob to the client.
  return json({
    source: source
      ? { ...source, secretRefs: undefined, hasCredentials: sourceHasCredentials(source) }
      : null,
  });
};

const putSchema = z.object({
  provider: z.enum(['susii', 'sunat-sire']).default('susii'),
  username: z.string().max(500).optional(),
  password: z.string().max(500).optional(),
  clientSecret: z.string().max(500).optional(),
  config: z.record(z.string(), z.unknown()),
  enabled: z.boolean().optional(),
});

export const PUT: RequestHandler = async ({ locals, request }) => {
  await requireOrgCapability(locals, 'finance', 'edit');
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, putSchema);
  const provider = body.provider;
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password.trim() : '';
  const clientSecret = typeof body.clientSecret === 'string' ? body.clientSecret.trim() : '';
  const existing = await getSource(ctx, provider);

  let config: Record<string, unknown>;
  try {
    config =
      provider === 'sunat-sire'
        ? parseSunatSourceConfig(body.config)
        : z.object({ businessId: z.number().int().positive().nullable() }).parse(body.config);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'invalid connector configuration';
    throw error(400, message.slice(0, 300));
  }

  // null = no probe ran (nothing to verify). true = the provider accepted these
  // credentials just now. Returned so the UI can confirm auth immediately
  // instead of leaving the user staring at `last_status`, which describes the
  // last SYNC and stays 'failed' until the next run — the exact confusion that
  // made a working credential look broken (Aug 2026).
  let verified: boolean | null = null;

  let secretRefs: Record<string, unknown>;
  // Both-or-neither, per provider. A half-filled form used to fall into the
  // "preserve existing" branch and return ok:true having changed nothing — so
  // "I updated the password" silently no-op'd and the sync kept failing with the
  // old credential (Aug 2026). Typing one field is always a mistake, never intent.
  const suppliedAnyCredential = !!(username || password || clientSecret);
  const suppliedCompleteCredentials =
    provider === 'sunat-sire' ? !!(username && password && clientSecret) : !!(username && password);
  if (suppliedAnyCredential && !suppliedCompleteCredentials) {
    throw error(400, 'Provide the complete credential set or leave every credential field blank.');
  }
  if (suppliedCompleteCredentials) {
    // Verify before storing: `count()` performs the provider login, so a bad
    // credential fails here with the provider's own reason instead of being
    // written and only surfacing as a failed job at 08:00 the next morning.
    const secrets: Record<string, string> = {
      username,
      password,
      ...(clientSecret ? { clientSecret } : {}),
    };
    const connector = getConnector(provider);
    if (connector?.count) {
      try {
        await connector.count({ config, secrets });
        verified = true;
      } catch (e) {
        throw error(
          400,
          `provider rejected these credentials: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    secretRefs = encryptCreds({ username, password, ...(clientSecret ? { clientSecret } : {}) });
  } else {
    // Every field blank — deliberate "keep what's stored" (editing config/enabled only).
    secretRefs = (existing?.secretRefs ?? {}) as Record<string, unknown>;
  }
  if (!sourceHasCredentials({ secretRefs })) {
    throw error(400, 'Credentials are required before this connector can be saved.');
  }

  await upsertSource(ctx, provider, {
    config,
    secretRefs,
    enabled: body.enabled !== false,
  });
  return json({ ok: true, verified });
};
