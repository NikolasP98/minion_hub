import { json, type RequestHandler } from '@sveltejs/kit';
import type { CoreCtx } from '$server/auth/core-ctx';
import { checkSharedRateLimit } from '$server/auth/shared-rate-limit';
import { getCoreDb } from '$server/db/pg-client';
import { handleMcp } from '$server/mcp/protocol';
import { sandboxFailure, sandboxTools } from '$server/mcp/sandbox-tools';
import { touchKey, verifyKey } from '$server/services/org-api-keys.service';

// Spec 136 S5. Stateless JSON-RPC over POST; no GET (SvelteKit answers 405 for the missing
// verb). Authentication is the Bearer org API key alone, as in `doors/caller.ts`.
const CALLS_PER_MINUTE = 120;
const TOUCH_AFTER_MS = 60_000;
const MAX_BODY_BYTES = 256 * 1024;

const refuse = (status: number, error: string) => json({ error }, { status });

export const POST: RequestHandler = async ({ request }) => {
  const auth = request.headers.get('authorization') ?? '';
  const key = auth.startsWith('Bearer mk_') ? await verifyKey(auth.slice('Bearer '.length)) : null;
  if (!key)
    return refuse(401, 'Send a valid organization API key as "Authorization: Bearer mk_…".');
  if (!key.scopes.includes('sandbox'))
    return refuse(403, 'This API key does not have the "sandbox" scope.');
  if (!(await checkSharedRateLimit(`mcp-key:${key.id}`, CALLS_PER_MINUTE)))
    return new Response(JSON.stringify({ error: 'Too many requests. Wait a minute and retry.' }), {
      status: 429,
      headers: { 'content-type': 'application/json', 'retry-after': '60' },
    });
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > TOUCH_AFTER_MS)
    await touchKey(key.id);

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return refuse(413, 'The request body is too large.');
  // Acts for the key's organization alone; elements it writes have no author, only the key.
  const ctx: CoreCtx = { db: getCoreDb(), tenantId: key.orgId };
  const reply = await handleMcp(text, sandboxTools, { ctx, keyId: key.id }, sandboxFailure);
  return reply.body === undefined
    ? new Response(null, { status: reply.status })
    : json(reply.body, { status: reply.status });
};
