import { eq, and, inArray, lt, sql } from 'drizzle-orm';
import { error as httpError } from '@sveltejs/kit';
import { personalAgents } from '@minion-stack/db/schema';
import { user } from '@minion-stack/db/schema';
import { newId, nowMs } from '$server/db/utils';
import { assignAgentToUser } from './user-agents.service';
import type { TenantContext } from './base';
import type { LoadCtx } from './types';

// ── Types ────────────────────────────────────────────────────────────────────

export type PersonalAgentRow = typeof personalAgents.$inferSelect;
export type ProvisioningStatus = 'pending' | 'provisioning' | 'active' | 'error';
export type PersonalityPreset = 'professional' | 'casual' | 'creative' | 'technical';

export interface PersonalAgentUpdate {
  avatarUrl: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function derivePersonalAgentId(userId: string): string {
  return `personal-${userId}`;
}

// ── Service Functions ────────────────────────────────────────────────────────

export async function provisionPersonalAgent(
  ctx: TenantContext,
  params: { userId: string; email: string; serverId: string },
): Promise<PersonalAgentRow> {
  const agentId = derivePersonalAgentId(params.userId);
  const now = nowMs();

  // NOTE: The schema in packages/db is dropping `display_name` (Phase 2b),
  // `personality_preset`, `personality_text`, `personality_configured`,
  // and `conversation_name` (Phase 3c) — all of those now live in the
  // gateway config. Until @minion-stack/db v0.3.0 ships on npm, the
  // pinned `$inferInsert` type still requires the deprecated columns.
  // We pass empty / default placeholders which the 0012 + 0013 migrations
  // drop from the table entirely.
  // TODO(post-publish): remove this cast and the placeholder fields once
  // @minion-stack/db v0.3.0 ships without the deprecated columns.
  const row: typeof personalAgents.$inferInsert = {
    id: newId(),
    userId: params.userId,
    agentId,
    // Coerce empty string to null — the column is FK→servers.id and nullable.
    // Callers like hooks.server.ts pass '' when no default server is known
    // (e.g. fresh local DB with no configured host), which would trigger
    // SQLITE_CONSTRAINT_FOREIGNKEY since '' isn't a valid server id.
    serverId: params.serverId === '' ? null : params.serverId,
    displayName: '',
    personalityConfigured: false,
    provisioningStatus: 'pending',
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
  } as typeof personalAgents.$inferInsert;

  // Insert with onConflictDoNothing for idempotency (userId is unique)
  await ctx.db.insert(personalAgents).values(row).onConflictDoNothing();

  // Update user.personalAgentId for fast lookup
  await ctx.db.update(user).set({ personalAgentId: agentId }).where(eq(user.id, params.userId));

  // Also insert into user_agents for JWT agentIds compatibility.
  // user_agents.server_id is NOT NULL + FK→servers.id, so skip when no
  // server is configured (e.g. fresh local DB). The assignment will
  // happen later when a host is added through the UI.
  if (params.serverId) {
    await assignAgentToUser(ctx, params.userId, agentId, params.serverId);
  }

  // Return the row (either newly created or existing)
  const [existing] = await ctx.db
    .select()
    .from(personalAgents)
    .where(eq(personalAgents.userId, params.userId))
    .limit(1);

  return existing ?? row;
}

export async function getPersonalAgent(
  ctx: TenantContext,
  userId: string,
): Promise<PersonalAgentRow | null> {
  const rows = await ctx.db
    .select()
    .from(personalAgents)
    .where(eq(personalAgents.userId, userId))
    .limit(1);

  return rows[0] ?? null;
}

export async function updatePersonalAgent(
  ctx: TenantContext,
  userId: string,
  updates: Partial<PersonalAgentUpdate>,
): Promise<void> {
  await ctx.db
    .update(personalAgents)
    .set({
      ...updates,
      updatedAt: nowMs(),
    })
    .where(eq(personalAgents.userId, userId));
}

export async function updateProvisioningStatus(
  ctx: TenantContext,
  userId: string,
  status: ProvisioningStatus,
  error?: string,
): Promise<void> {
  const now = nowMs();
  const setData: Record<string, unknown> = {
    provisioningStatus: status,
    updatedAt: now,
  };

  if (status === 'error') {
    setData.provisioningError = error ?? null;
    setData.lastRetryAt = now;
    setData.retryCount = sql`${personalAgents.retryCount} + 1`;
  }

  if (status === 'active') {
    setData.provisioningError = null;
  }

  await ctx.db.update(personalAgents).set(setData).where(eq(personalAgents.userId, userId));
}

export async function ensurePersonalAgentOnLogin(
  ctx: TenantContext,
  params: { userId: string; email: string; serverId: string },
): Promise<PersonalAgentRow> {
  const existing = await getPersonalAgent(ctx, params.userId);
  if (existing) return existing;
  return provisionPersonalAgent(ctx, params);
}

export async function listPendingAgents(
  ctx: TenantContext,
  maxRetries: number = 5,
): Promise<PersonalAgentRow[]> {
  return ctx.db
    .select()
    .from(personalAgents)
    .where(
      and(
        inArray(personalAgents.provisioningStatus, ['pending', 'error']),
        lt(personalAgents.retryCount, maxRetries),
      ),
    );
}

export async function deletePersonalAgent(ctx: TenantContext, userId: string): Promise<void> {
  await ctx.db.delete(personalAgents).where(eq(personalAgents.userId, userId));
}

/**
 * List personal agents of users in the tenant, labeled by username.
 * Tenant scoping matches listUsers(ctx) (route-level via tenantCtx). Inner-join
 * means only users WITH a personal agent are returned. Label = name ?? email.
 */
export async function listOrgPersonalAgents(
  ctx: TenantContext,
): Promise<Array<{ agentId: string; userName: string }>> {
  return ctx.db
    .select({
      agentId: personalAgents.agentId,
      userName: sql<string>`coalesce(${user.name}, ${user.email})`,
    })
    .from(personalAgents)
    .innerJoin(user, eq(user.id, personalAgents.userId))
    .orderBy(user.createdAt);
}

// ── Load helper (callable from +server.ts AND +layout.server.ts) ────────────

export interface PersonalAgentLoadResult {
  agent: PersonalAgentRow | null;
}

/**
 * Load the authenticated user's personal agent row, shaped exactly like
 * `GET /api/personal-agent` (`{ agent }`).
 *
 * Resolves the tenant context internally (matching the endpoint behavior:
 * fall back to the first organization if `locals.tenantCtx` is unset).
 * Throws 401 if no tenant has been seeded yet.
 *
 * Implementation note: `getTenantCtx` is imported dynamically because it
 * pulls in `$server/db/client` (and through it `$env/dynamic/private`),
 * which the existing unit tests for this module don't stub. Keeping the
 * top-level import surface unchanged preserves test isolation.
 */
export async function loadPersonalAgentForUser(
  locals: LoadCtx,
  userId: string,
): Promise<PersonalAgentLoadResult> {
  const { getTenantCtx } = await import('$server/auth/tenant-ctx');
  const ctx = await getTenantCtx(locals as App.Locals);
  if (!ctx) throw httpError(401, 'Authentication required');
  const agent = await getPersonalAgent(ctx, userId);
  return { agent };
}
