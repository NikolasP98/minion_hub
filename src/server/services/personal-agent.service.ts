import { eq, and, inArray, lt, or, sql } from 'drizzle-orm';
import { error as httpError } from '@sveltejs/kit';
import { personalAgents, profiles } from '@minion-stack/db/pg';
import { newId } from '$server/db/utils';
import { getDb } from '$server/db/client';
import { assignAgentToUser } from './user-agents.service';
import { resolveGatewayId, resolveServerId } from '$server/services/gateway.pg.service';
import type { CoreCtx } from '$server/auth/core-ctx';
import type { LoadCtx } from './types';

// ── Types ────────────────────────────────────────────────────────────────────

export type ProvisioningStatus = 'pending' | 'provisioning' | 'active' | 'error';
export type PersonalityPreset = 'professional' | 'casual' | 'creative' | 'technical';

/**
 * Public (reshaped) personal-agent shape. pg keys on `profile_id` (profiles.id)
 * + `gateway_id` and stores timestamps as Date, but this service keeps the
 * Turso-era shape — `userId` (echoed: the legacy id the caller passed),
 * `serverId` (reverse-resolved), epoch-number timestamps — so the provisioner
 * (which does `lastRetryAt + backoff`) and the frontend are unaffected.
 */
export interface PersonalAgentRow {
  id: string;
  userId: string;
  agentId: string;
  serverId: string | null;
  displayName: string;
  conversationName: string | null;
  avatarUrl: string | null;
  personalityPreset: PersonalityPreset | null;
  personalityText: string | null;
  personalityConfigured: boolean;
  provisioningStatus: ProvisioningStatus;
  provisioningError: string | null;
  lastRetryAt: number | null;
  retryCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface PersonalAgentUpdate {
  avatarUrl: string | null;
}

type PgRow = typeof personalAgents.$inferSelect;

async function reshape(row: PgRow, userId: string): Promise<PersonalAgentRow> {
  return {
    id: row.id,
    userId,
    agentId: row.agentId,
    serverId: row.gatewayId ? await resolveServerId(row.gatewayId) : null,
    displayName: row.displayName,
    conversationName: row.conversationName,
    avatarUrl: row.avatarUrl,
    personalityPreset: row.personalityPreset,
    personalityText: row.personalityText,
    personalityConfigured: row.personalityConfigured,
    provisioningStatus: row.provisioningStatus,
    provisioningError: row.provisioningError,
    lastRetryAt: row.lastRetryAt ? row.lastRetryAt.getTime() : null,
    retryCount: row.retryCount,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function derivePersonalAgentId(userId: string): string {
  return `personal-${userId}`;
}

/**
 * Rows are read by `agent_id` (= `personal-<legacy userId>`, derivable from the
 * caller's userId), so reads never need the supabase profile id. Only the
 * provision INSERT needs `profile_id` (FK → profiles.id); resolve it from the
 * legacy userId via `profiles.legacy_user_id` (or `id` for native users).
 */
async function resolveProfileId(ctx: CoreCtx, userId: string): Promise<string | null> {
  const [row] = await ctx.db
    .select({ id: profiles.id })
    .from(profiles)
    .where(or(eq(profiles.legacyUserId, userId), sql`${profiles.id}::text = ${userId}`))
    .limit(1);
  return row?.id ?? null;
}

// ── Service Functions ────────────────────────────────────────────────────────

export async function provisionPersonalAgent(
  ctx: CoreCtx,
  params: { userId: string; email: string; serverId: string },
): Promise<PersonalAgentRow> {
  const agentId = derivePersonalAgentId(params.userId);

  const profileId = await resolveProfileId(ctx, params.userId);
  if (!profileId) {
    throw new Error(`No profile found for user ${params.userId} — cannot provision personal agent`);
  }

  const gatewayId = params.serverId ? await resolveGatewayId(params.serverId) : null;

  // Insert with onConflictDoNothing for idempotency (profile_id is unique).
  await ctx.db
    .insert(personalAgents)
    .values({
      id: newId(),
      profileId,
      agentId,
      gatewayId,
      displayName: '',
      personalityConfigured: false,
      provisioningStatus: 'pending',
      retryCount: 0,
    })
    .onConflictDoNothing();

  // Denormalised fast-lookup pointer (read by the login backfill gate).
  await ctx.db.update(profiles).set({ personalAgentId: agentId }).where(eq(profiles.id, profileId));

  // user_agents stays on Turso (separate user-owned domain); only the migration
  // path passes a serverId, so this cross-store write is migration-only.
  if (params.serverId) {
    await assignAgentToUser(
      { db: getDb(), tenantId: ctx.tenantId },
      params.userId,
      agentId,
      params.serverId,
    );
  }

  const [existing] = await ctx.db
    .select()
    .from(personalAgents)
    .where(eq(personalAgents.profileId, profileId))
    .limit(1);

  return reshape(existing, params.userId);
}

export async function getPersonalAgent(
  ctx: CoreCtx,
  userId: string,
): Promise<PersonalAgentRow | null> {
  // Key by profile_id (resolved from legacy id OR supabase uuid) rather than the
  // legacy-derived agent_id, so this is identity-format-agnostic and survives the
  // legacy→uuid bridge flip. Behavior-preserving: profile_id of the row whose
  // agent_id is `personal-<legacyId>` is the same profile.
  const profileId = await resolveProfileId(ctx, userId);
  if (!profileId) return null;
  const rows = await ctx.db
    .select()
    .from(personalAgents)
    .where(eq(personalAgents.profileId, profileId))
    .limit(1);

  return rows[0] ? reshape(rows[0], userId) : null;
}

export async function updatePersonalAgent(
  ctx: CoreCtx,
  userId: string,
  updates: Partial<PersonalAgentUpdate>,
): Promise<void> {
  const profileId = await resolveProfileId(ctx, userId);
  if (!profileId) return;
  await ctx.db
    .update(personalAgents)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(personalAgents.profileId, profileId));
}

export async function updateProvisioningStatus(
  ctx: CoreCtx,
  userId: string,
  status: ProvisioningStatus,
  error?: string,
): Promise<void> {
  const setData: Record<string, unknown> = {
    provisioningStatus: status,
    updatedAt: new Date(),
  };

  if (status === 'error') {
    setData.provisioningError = error ?? null;
    setData.lastRetryAt = new Date();
    setData.retryCount = sql`${personalAgents.retryCount} + 1`;
  }

  if (status === 'active') {
    setData.provisioningError = null;
  }

  const profileId = await resolveProfileId(ctx, userId);
  if (!profileId) return;
  await ctx.db
    .update(personalAgents)
    .set(setData)
    .where(eq(personalAgents.profileId, profileId));
}

export async function ensurePersonalAgentOnLogin(
  ctx: CoreCtx,
  params: { userId: string; email: string; serverId: string },
): Promise<PersonalAgentRow> {
  const existing = await getPersonalAgent(ctx, params.userId);
  if (existing) return existing;
  return provisionPersonalAgent(ctx, params);
}

export async function listPendingAgents(
  ctx: CoreCtx,
  maxRetries: number = 5,
): Promise<PersonalAgentRow[]> {
  // Join profiles to recover the legacy userId for the echoed `userId` field.
  const rows = await ctx.db
    .select({ pa: personalAgents, legacyUserId: profiles.legacyUserId })
    .from(personalAgents)
    .innerJoin(profiles, eq(profiles.id, personalAgents.profileId))
    .where(
      and(
        inArray(personalAgents.provisioningStatus, ['pending', 'error']),
        lt(personalAgents.retryCount, maxRetries),
      ),
    );
  return Promise.all(rows.map((r) => reshape(r.pa, r.legacyUserId ?? r.pa.profileId)));
}

export async function deletePersonalAgent(ctx: CoreCtx, userId: string): Promise<void> {
  const profileId = await resolveProfileId(ctx, userId);
  if (!profileId) return;
  await ctx.db.delete(personalAgents).where(eq(personalAgents.profileId, profileId));
}

/**
 * List personal agents of users in the org, labeled by username. pg join of
 * personal_agents ⋈ profiles (replaces the Turso `personalAgents ⋈ user` join).
 * Label = displayName ?? email.
 */
export async function listOrgPersonalAgents(
  ctx: CoreCtx,
): Promise<Array<{ agentId: string; userName: string }>> {
  return ctx.db
    .select({
      agentId: personalAgents.agentId,
      userName: sql<string>`coalesce(${profiles.displayName}, ${profiles.email})`,
    })
    .from(personalAgents)
    .innerJoin(profiles, eq(profiles.id, personalAgents.profileId))
    .orderBy(profiles.createdAt);
}

// ── Load helper (callable from +server.ts AND +layout.server.ts) ────────────

export interface PersonalAgentLoadResult {
  agent: PersonalAgentRow | null;
}

/**
 * Load the authenticated user's personal agent row, shaped exactly like
 * `GET /api/personal-agent` (`{ agent }`).
 *
 * Resolves the core (Supabase) tenant context internally, matching the endpoint
 * behavior. Throws 401 if no tenant has been seeded yet. `getCoreCtx` is
 * imported dynamically to keep the top-level import surface unchanged for the
 * existing unit tests.
 */
export async function loadPersonalAgentForUser(
  locals: LoadCtx,
  userId: string,
): Promise<PersonalAgentLoadResult> {
  const { getCoreCtx } = await import('$server/auth/core-ctx');
  const ctx = await getCoreCtx(locals as App.Locals);
  if (!ctx) throw httpError(401, 'Authentication required');
  const agent = await getPersonalAgent(ctx, userId);
  return { agent };
}
