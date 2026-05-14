import { eq } from 'drizzle-orm';
import { createPaperclipClient } from '@minion-stack/paperclip-client';
import { env } from '$env/dynamic/private';
import { getDb } from '$server/db/client';
import { workspaceMembership } from '$server/db/schema/workspace-membership';
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
  userId: string,
): Promise<WorkspaceLoadEntry[]> {
  const db = getDb();
  const memberships = await db
    .select()
    .from(workspaceMembership)
    .where(eq(workspaceMembership.userId, userId));

  // Hydrate display name per company from paperclip. Graceful on outage.
  const token = ctx.paperclipIdentity?.token;
  let companies: Array<{ id: string; name: string }> = [];
  if (token) {
    const client = createPaperclipClient({
      baseUrl: paperclipBaseUrl(),
      fetch: globalThis.fetch,
      headers: { 'x-hub-identity': token },
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
