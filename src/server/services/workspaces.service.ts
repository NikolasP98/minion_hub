import { eq } from 'drizzle-orm';
import { cached, keys } from '@minion-stack/cache';
import { createWorkforceClient } from '@minion-stack/workforce-client';
import { env } from '$env/dynamic/private';
import { getCoreDb } from '$server/db/pg-client';
import { workspaceMembership } from '@minion-stack/db/pg';
import type { LoadCtx } from './types';

export interface WorkspaceLoadEntry {
  companyId: string;
  role: string;
  name: string;
}

function paperclipBaseUrl(): string {
  return env.PAPERCLIP_INTERNAL_URL ?? 'http://paperclip:3200';
}

/**
 * Load the authenticated user's workspace memberships and hydrate the
 * display name for each from paperclip (graceful on paperclip outage —
 * falls back to the company id as the name).
 *
 * Response shape is byte-identical to `GET /api/workspaces`.
 */
export async function loadWorkspacesForUser(
  ctx: LoadCtx,
  userId: string | undefined,
): Promise<WorkspaceLoadEntry[]> {
  // workspace_membership.user_id is profiles.id (Supabase uuid) — pass
  // user.supabaseId. No identity → no memberships (avoid a uuid query that throws).
  if (!userId) return [];
  const db = getCoreDb();
  const memberships = await db
    .select()
    .from(workspaceMembership)
    .where(eq(workspaceMembership.userId, userId));

  // Hydrate display name per company from paperclip. Graceful on outage.
  const token = ctx.workforceIdentity?.token;
  let companies: Array<{ id: string; name: string }> = [];
  if (token) {
    // Board-key tokens (pcli_*) go via `Authorization: Bearer`; JWT identity
    // tokens go via `x-hub-identity`. See reference_hub_paperclip_auth_header_split.
    const headers: Record<string, string> = token.startsWith('pcli_')
      ? { Authorization: `Bearer ${token}` }
      : { 'x-hub-identity': token };
    const client = createWorkforceClient({
      baseUrl: paperclipBaseUrl(),
      fetch: globalThis.fetch,
      headers,
    });
    // Paperclip is on the (app) layout's critical path. `.catch` already covers
    // a failing call, but a SLOW/hanging paperclip would still block every page
    // load — so race it against a short timeout. On timeout we return [] (names
    // fall back to the company id below), exactly like the outage path.
    // Company display names are near-static; cache per user so the layout's
    // critical path skips the paperclip HTTP hop on warm navigations. An empty
    // result (outage/timeout) is NOT cached — names just fall back to ids.
    companies = await cached(
      keys.hub('pc-companies', { u: userId }),
      { ttl: '5m', swr: '1m' },
      async () => {
        const list = await Promise.race([
          client.companies.list().catch(() => []),
          new Promise<Array<{ id: string; name: string }>>((resolve) =>
            setTimeout(() => resolve([]), 2_000),
          ),
        ]);
        if (list.length === 0) throw new Error('paperclip companies unavailable');
        return list;
      },
    ).catch(() => []);
  }
  const byId = new Map(companies.map((c) => [c.id, c]));

  return memberships.map((m) => ({
    companyId: m.paperclipCompanyId,
    role: m.role,
    name: byId.get(m.paperclipCompanyId)?.name ?? m.paperclipCompanyId,
  }));
}
