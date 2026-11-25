import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, count, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { profiles } from '@minion-stack/db/pg';
import { getCoreDb } from '$server/db/pg-client';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { orgApiKeys } from '$server/db/pg-org-integrations-schema';
import { isUniqueViolation } from './pos/db-errors';
import { assertOwnerInTx } from './record-locks.service';
import { API_KEY_SCOPES, type ApiKeyRow, type ApiKeyScope } from '$lib/types/api-keys';

export type { ApiKeyRow };

/**
 * Organization API keys (spec 121 S1). A key is `mk_<8 hex>_<43 base64url>`; only its
 * prefix and the SHA-256 hex of the whole text are stored. The text exists in exactly
 * one response (the one that creates it) and is never logged.
 *
 * SECURITY BOUNDARY: `verifyKey` runs before the organization is known (a public door
 * call), so it reads by prefix on the bypass-RLS `getCoreDb()`; everything an admin
 * does runs inside `withOrgCore` for the caller's organization.
 */

export const KEY_RE = /^mk_([0-9a-f]{8})_[A-Za-z0-9_-]{43}$/;
export const KEY_NAME_MAX = 60;
export const ACTIVE_KEY_LIMIT = 10;

export type ApiKeyErrorCode = 'invalid_name' | 'invalid_scope' | 'limit_reached' | 'not_found';

export class ApiKeyError extends Error {
  constructor(public readonly code: ApiKeyErrorCode) {
    super(code);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Drizzle wraps the driver error, so the code may sit on `.cause` (as in doors.service).
const uniqueViolation = (e: unknown) =>
  isUniqueViolation(e) || isUniqueViolation((e as { cause?: unknown } | null)?.cause);

export function generateKey(): { key: string; prefix: string } {
  const prefix = randomBytes(4).toString('hex');
  return { key: `mk_${prefix}_${randomBytes(32).toString('base64url')}`, prefix };
}

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

/** Create a key; the returned `key` is the only time its text leaves the server. The `locks` scope needs an owner (throws `owner_required`). */
export async function createKey(
  ctx: CoreCtx,
  rawName: string,
  scopes: readonly string[] = [],
): Promise<ApiKeyRow & { key: string }> {
  const name = rawName.trim();
  if (!name || name.length > KEY_NAME_MAX) throw new ApiKeyError('invalid_name');
  if (!scopes.every((s) => (API_KEY_SCOPES as readonly string[]).includes(s)))
    throw new ApiKeyError('invalid_scope');
  // A prefix collision (1 in 4 billion) aborts its transaction, so each draw is its own.
  for (let attempt = 1; ; attempt++) {
    const { key, prefix } = generateKey();
    try {
      const created = await withOrgCore(ctx, async (tx) => {
        // A `locks` key can lift the accounting system's locks, so only an owner may mint one (spec 140).
        if (scopes.includes('locks')) await assertOwnerInTx(tx, ctx);
        // shortcut: count then insert, so two admins at the same instant may reach 11 (FR-004 accepts it).
        const [active] = await tx
          .select({ n: count() })
          .from(orgApiKeys)
          .where(and(eq(orgApiKeys.orgId, ctx.tenantId), isNull(orgApiKeys.revokedAt)));
        if (Number(active?.n ?? 0) >= ACTIVE_KEY_LIMIT) throw new ApiKeyError('limit_reached');
        const [inserted] = await tx
          .insert(orgApiKeys)
          .values({
            orgId: ctx.tenantId,
            name,
            prefix,
            keyHash: hashKey(key),
            createdBy: ctx.profileId ?? null,
            scopes: [...new Set(scopes)],
          })
          .returning();
        return inserted!;
      });
      const [listed] = await withNames(ctx, [created]);
      return { ...listed!, key };
    } catch (e) {
      if (attempt >= 3 || !uniqueViolation(e)) throw e;
    }
  }
}

/** Every key of the organization, newest first. */
export async function listKeys(ctx: CoreCtx): Promise<ApiKeyRow[]> {
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(orgApiKeys)
      .where(eq(orgApiKeys.orgId, ctx.tenantId))
      .orderBy(desc(orgApiKeys.createdAt)),
  );
  return withNames(ctx, rows);
}

/** Revoke (idempotent; a revoked key stays revoked by its first revoker). */
export async function revokeKey(ctx: CoreCtx, id: string): Promise<void> {
  if (!UUID_RE.test(id)) throw new ApiKeyError('not_found');
  const found = await withOrgCore(ctx, async (tx) => {
    const [hit] = await tx
      .select({ id: orgApiKeys.id, revokedAt: orgApiKeys.revokedAt })
      .from(orgApiKeys)
      .where(and(eq(orgApiKeys.id, id), eq(orgApiKeys.orgId, ctx.tenantId)))
      .limit(1);
    if (hit && !hit.revokedAt)
      await tx
        .update(orgApiKeys)
        .set({ revokedAt: new Date(), revokedBy: ctx.profileId ?? null })
        .where(and(eq(orgApiKeys.id, id), isNull(orgApiKeys.revokedAt)));
    return !!hit;
  });
  if (!found) throw new ApiKeyError('not_found');
}

/**
 * The active key whose text this is, or null. Malformed text returns null without a
 * query; the hash comparison is constant-time.
 */
export async function verifyKey(text: string): Promise<{
  id: string;
  orgId: string;
  name: string;
  lastUsedAt: Date | null;
  scopes: string[];
} | null> {
  const match = KEY_RE.exec(text);
  if (!match) return null;
  const [hit] = await getCoreDb()
    .select({
      id: orgApiKeys.id,
      orgId: orgApiKeys.orgId,
      name: orgApiKeys.name,
      keyHash: orgApiKeys.keyHash,
      lastUsedAt: orgApiKeys.lastUsedAt,
      revokedAt: orgApiKeys.revokedAt,
      scopes: orgApiKeys.scopes,
    })
    .from(orgApiKeys)
    .where(eq(orgApiKeys.prefix, match[1]!))
    .limit(1);
  if (!hit || hit.revokedAt) return null;
  const a = Buffer.from(hashKey(text), 'hex');
  const b = Buffer.from(hit.keyHash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return {
    id: hit.id,
    orgId: hit.orgId,
    name: hit.name,
    lastUsedAt: hit.lastUsedAt,
    scopes: hit.scopes,
  };
}

/** Record a use; the condition keeps it to at most one write per key and minute. */
export async function touchKey(id: string): Promise<void> {
  await getCoreDb()
    .update(orgApiKeys)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(
        eq(orgApiKeys.id, id),
        or(
          isNull(orgApiKeys.lastUsedAt),
          lt(orgApiKeys.lastUsedAt, sql`now() - interval '1 minute'`),
        ),
      ),
    );
}

async function withNames(
  ctx: CoreCtx,
  rows: Array<typeof orgApiKeys.$inferSelect>,
): Promise<ApiKeyRow[]> {
  const ids = [
    ...new Set(rows.flatMap((r) => [r.createdBy, r.revokedBy]).filter((v): v is string => !!v)),
  ];
  // Same read as the POS/scheduling actor names; a person who no longer exists stays null.
  const names = ids.length
    ? await ctx.db
        .select({ id: profiles.id, displayName: profiles.displayName, email: profiles.email })
        .from(profiles)
        .where(inArray(profiles.id, ids))
        .then((list) => new Map(list.map((p) => [p.id, p.displayName || p.email || null])))
        .catch(() => new Map<string, string | null>())
    : new Map<string, string | null>();
  const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    createdAt: r.createdAt.toISOString(),
    createdByName: name(r.createdBy),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    revokedAt: r.revokedAt?.toISOString() ?? null,
    revokedByName: name(r.revokedBy),
    scopes: r.scopes as ApiKeyScope[],
  }));
}
