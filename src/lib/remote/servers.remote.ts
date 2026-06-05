/**
 * Remote functions for gateway (server/host) WRITE operations — consumed by
 * hosts.svelte.ts. Mirrors POST `/api/servers`, PUT/DELETE `/api/servers/[id]`,
 * including the SSRF URL guard and the per-user ownership check.
 *
 * READS stay where they are: the hosts list flows through the canonical
 * `(app)/+layout.server.ts` bundle into `page.data` (client-fetching it would
 * reintroduce the OAuth-callback 401 race). The token-decryption endpoint
 * (`POST /api/servers/[id]/token`) also stays a route (sensitive, no-store).
 */
import { command } from '$app/server';
import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { currentUser, currentOrCreateCtx } from '$server/remote/guard';
import { upsertServer, deleteServer } from '$server/services/server.service';
import { assertSafeUrl, SsrfBlockedError } from '$server/services/ssrf-guard';
import { getPostHogClient } from '$lib/server/posthog';
import { userServers } from '@minion-stack/db/schema';
import type { TenantContext } from '$server/services/base';

/** Non-admins must be linked to the server via `user_servers`. */
async function ownsOrAdmin(
  ctx: TenantContext,
  user: { id: string; role: 'user' | 'admin' },
  serverId: string,
): Promise<boolean> {
  if (user.role === 'admin') return true;
  const [link] = await ctx.db
    .select({ serverId: userServers.serverId })
    .from(userServers)
    .where(and(eq(userServers.userId, user.id), eq(userServers.serverId, serverId)));
  return !!link;
}

/** Add a gateway. Validates the URL (SSRF guard → 422 on block). */
export const addServer = command(
  z.object({
    id: z.string().optional(),
    name: z.string(),
    url: z.string(),
    token: z.string().optional(),
    lastConnectedAt: z.number().nullable().optional(),
  }),
  async (body) => {
    const user = currentUser();
    const ctx = await currentOrCreateCtx();
    try {
      await assertSafeUrl(body.url, 'server URL');
    } catch (err) {
      if (err instanceof SsrfBlockedError) error(422, err.message);
      throw err;
    }
    await upsertServer(ctx, body, user.id);
    const posthog = await getPostHogClient();
    posthog?.capture({
      distinctId: user.id,
      event: 'server_added',
      properties: { server_name: body.name, server_url: body.url },
    });
    return { ok: true as const };
  },
);

/** Update a gateway's fields (404 if the user doesn't own it). */
export const updateServer = command(
  z.object({
    id: z.string().min(1),
    name: z.string().optional(),
    url: z.string().optional(),
    token: z.string().optional(),
    lastConnectedAt: z.number().nullable().optional(),
  }),
  async ({ id, ...updates }) => {
    const user = currentUser();
    const ctx = await currentOrCreateCtx();
    if (!(await ownsOrAdmin(ctx, user, id))) error(404, 'Not found');
    await upsertServer(ctx, { id, name: '', url: '', ...updates }, user.id);
    return { ok: true as const };
  },
);

/** Remove a gateway (404 if the user doesn't own it). */
export const removeServer = command(z.string().min(1), async (id) => {
  const user = currentUser();
  const ctx = await currentOrCreateCtx();
  if (!(await ownsOrAdmin(ctx, user, id))) error(404, 'Not found');
  await deleteServer(ctx, id);
  return { ok: true as const };
});
