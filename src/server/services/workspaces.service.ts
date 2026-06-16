import { eq } from 'drizzle-orm';
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
    companies = await client.companies.list().catch(() => []);
  }
  const byId = new Map(companies.map((c) => [c.id, c]));

  return memberships.map((m) => ({
    companyId: m.paperclipCompanyId,
    role: m.role,
    name: byId.get(m.paperclipCompanyId)?.name ?? m.paperclipCompanyId,
  }));
}
