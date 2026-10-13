import { error } from '@sveltejs/kit';
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import { appNotifications, appNotificationReads } from '$server/db/pg-inbox-schema';
import { listOrgCapabilityKeys } from '$server/services/rbac.service';
import type { CoreCtx } from '$server/auth/core-ctx';

export type NotificationScope = 'global' | 'org' | 'role' | 'user';
export type NotificationSeverity = 'info' | 'warning' | 'critical';

export interface FeedItem {
  id: string;
  scope: NotificationScope;
  kind: string;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  href: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  readAt: Date | null;
  dismissedAt: Date | null;
}

export interface Draft {
  scope: NotificationScope;
  orgId?: string | null;
  capability?: string | null;
  profileId?: string | null;
  kind: string;
  severity?: NotificationSeverity;
  title: string;
  body?: string | null;
  href?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  dedupeKey?: string | null;
  data?: Record<string, unknown>;
  expiresAt?: Date | null;
}

const a = appNotifications;
const r = appNotificationReads;

/** Column list a reader may see: global ∪ org (already org-filtered by RLS and
 *  the explicit org_id branch below) ∪ role where the reader holds the
 *  capability in THIS org ∪ user = the reader. Shared by listFeed, unreadCount
 *  and the per-id guard markRead/dismiss use before writing read state. */
function visibilityPredicate(profileId: string, capabilityKeys: string[]) {
  const roleBranch =
    capabilityKeys.length > 0
      ? and(eq(a.scope, 'role'), inArray(a.capability, capabilityKeys))
      : sql`false`;
  return or(
    eq(a.scope, 'global'),
    eq(a.scope, 'org'),
    roleBranch,
    and(eq(a.scope, 'user'), eq(a.profileId, profileId)),
  );
}

async function resolveReaderScope(ctx: CoreCtx): Promise<string[]> {
  if (!ctx.profileId) throw error(401, 'Authentication required');
  return listOrgCapabilityKeys(ctx.tenantId, ctx.profileId);
}

/** `expires_at`-aware "still active" filter — an expired row leaves the feed
 *  the same way a resolved one does, without needing a sweep job. */
const notExpired = or(isNull(a.expiresAt), sql`${a.expiresAt} > now()`);

export interface ListFeedOptions {
  kinds?: string[];
  includeResolved?: boolean;
  limit?: number;
  /** Opaque cursor = the ISO `created_at` of the last item on the previous page.
   *  TODO(handoff): ties at identical microsecond timestamps could skip a row;
   *  upgrade to a (created_at, id) composite cursor if that's ever observed. */
  cursor?: string;
}

export async function listFeed(
  ctx: CoreCtx,
  opts: ListFeedOptions = {},
): Promise<{ items: FeedItem[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  return withOrgCore(ctx, async (tx) => {
    const capabilityKeys = await resolveReaderScope(ctx);
    const conditions = [
      or(isNull(a.orgId), eq(a.orgId, ctx.tenantId)),
      visibilityPredicate(ctx.profileId!, capabilityKeys),
      notExpired,
    ];
    if (!opts.includeResolved) conditions.push(isNull(a.resolvedAt));
    // Dismissed is per reader and permanent for the feed (unreadCount agrees).
    conditions.push(isNull(r.dismissedAt));
    if (opts.kinds && opts.kinds.length > 0) conditions.push(inArray(a.kind, opts.kinds));
    if (opts.cursor) conditions.push(lt(a.createdAt, new Date(opts.cursor)));

    const rows = await tx
      .select({
        id: a.id,
        scope: a.scope,
        kind: a.kind,
        severity: a.severity,
        title: a.title,
        body: a.body,
        href: a.href,
        createdAt: a.createdAt,
        resolvedAt: a.resolvedAt,
        readAt: r.readAt,
        dismissedAt: r.dismissedAt,
      })
      .from(a)
      .leftJoin(r, and(eq(r.notificationId, a.id), eq(r.profileId, ctx.profileId!)))
      .where(and(...conditions))
      .orderBy(desc(a.createdAt))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const nextCursor = rows.length > limit ? page[page.length - 1].createdAt.toISOString() : null;
    return {
      items: page as unknown as FeedItem[],
      nextCursor,
    };
  });
}

export async function unreadCount(ctx: CoreCtx): Promise<number> {
  return withOrgCore(ctx, async (tx) => {
    const capabilityKeys = await resolveReaderScope(ctx);
    const [row] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(a)
      .leftJoin(r, and(eq(r.notificationId, a.id), eq(r.profileId, ctx.profileId!)))
      .where(
        and(
          or(isNull(a.orgId), eq(a.orgId, ctx.tenantId)),
          visibilityPredicate(ctx.profileId!, capabilityKeys),
          notExpired,
          isNull(a.resolvedAt),
          isNull(r.readAt),
          isNull(r.dismissedAt),
        ),
      );
    return Number(row?.count ?? 0);
  });
}

/** Throws 404 if `notificationId` isn't visible to this reader — the guard
 *  markRead/dismiss share so a caller can't toggle read state on a row outside
 *  their scope tiers (an id is guessable; visibility must still be enforced). */
async function assertVisible(tx: CoreTx, ctx: CoreCtx, notificationId: string): Promise<void> {
  const capabilityKeys = await resolveReaderScope(ctx);
  const [row] = await tx
    .select({ id: a.id })
    .from(a)
    .where(
      and(
        eq(a.id, notificationId),
        or(isNull(a.orgId), eq(a.orgId, ctx.tenantId)),
        visibilityPredicate(ctx.profileId!, capabilityKeys),
      ),
    )
    .limit(1);
  if (!row) throw error(404, 'Notification not found');
}

async function upsertRead(
  tx: CoreTx,
  profileId: string,
  notificationId: string,
  field: 'readAt' | 'dismissedAt',
): Promise<void> {
  await tx
    .insert(r)
    .values({ profileId, notificationId, [field]: new Date() })
    .onConflictDoUpdate({
      target: [r.profileId, r.notificationId],
      set: { [field]: new Date() },
    });
}

/** Clicking one notification also clears every other unread row that shares
 *  its click target (href) — e.g. five "What's new" release rows that all
 *  link to /changelog clear together (owner request 2026-10-12). A null href
 *  can't fan out, so it falls back to just the clicked id. Returns every
 *  notification id actually marked read, for the caller to sync its list. */
export async function markRead(ctx: CoreCtx, notificationId: string): Promise<string[]> {
  if (!ctx.profileId) throw error(401, 'Authentication required');
  return withOrgCore(ctx, async (tx) => {
    const capabilityKeys = await resolveReaderScope(ctx);
    const visible = and(
      or(isNull(a.orgId), eq(a.orgId, ctx.tenantId)),
      visibilityPredicate(ctx.profileId!, capabilityKeys),
    );
    const [clicked] = await tx
      .select({ id: a.id, href: a.href })
      .from(a)
      .where(and(eq(a.id, notificationId), visible))
      .limit(1);
    if (!clicked) throw error(404, 'Notification not found');

    const sameTarget = clicked.href !== null ? eq(a.href, clicked.href) : eq(a.id, clicked.id);
    const toMark = await tx
      .select({ id: a.id })
      .from(a)
      .leftJoin(r, and(eq(r.notificationId, a.id), eq(r.profileId, ctx.profileId!)))
      .where(and(sameTarget, visible, notExpired, isNull(a.resolvedAt), isNull(r.readAt)));

    const ids = toMark.length > 0 ? toMark.map((row) => row.id) : [clicked.id];
    const now = new Date();
    await tx
      .insert(r)
      .values(ids.map((id) => ({ profileId: ctx.profileId!, notificationId: id, readAt: now })))
      .onConflictDoUpdate({ target: [r.profileId, r.notificationId], set: { readAt: now } });
    return ids;
  });
}

export async function dismiss(ctx: CoreCtx, notificationId: string): Promise<void> {
  if (!ctx.profileId) throw error(401, 'Authentication required');
  await withOrgCore(ctx, async (tx) => {
    await assertVisible(tx, ctx, notificationId);
    await upsertRead(tx, ctx.profileId!, notificationId, 'dismissedAt');
  });
}

export async function readAll(ctx: CoreCtx): Promise<number> {
  if (!ctx.profileId) throw error(401, 'Authentication required');
  return withOrgCore(ctx, async (tx) => {
    const capabilityKeys = await resolveReaderScope(ctx);
    const visible = await tx
      .select({ id: a.id })
      .from(a)
      .leftJoin(r, and(eq(r.notificationId, a.id), eq(r.profileId, ctx.profileId!)))
      .where(
        and(
          or(isNull(a.orgId), eq(a.orgId, ctx.tenantId)),
          visibilityPredicate(ctx.profileId!, capabilityKeys),
          notExpired,
          isNull(a.resolvedAt),
          isNull(r.readAt),
        ),
      );
    if (visible.length === 0) return 0;
    const now = new Date();
    await tx
      .insert(r)
      .values(
        visible.map((v) => ({ profileId: ctx.profileId!, notificationId: v.id, readAt: now })),
      )
      .onConflictDoUpdate({ target: [r.profileId, r.notificationId], set: { readAt: now } });
    return visible.length;
  });
}

/** Producer API: insert-or-skip on the dedupe key, returning the row's id
 *  either way (the existing id on a conflict). `ctx.tenantId` scopes the
 *  insert's RLS check for org/role/user drafts; global drafts (orgId
 *  undefined) still run inside an org-scoped txn (any org works — RLS allows
 *  org_id is null regardless of the active GUC). */
export async function upsertNotification(ctx: CoreCtx, draft: Draft): Promise<string> {
  return withOrgCore(ctx, async (tx) => {
    const [inserted] = await tx
      .insert(a)
      .values({
        scope: draft.scope,
        orgId: draft.orgId ?? null,
        capability: draft.capability ?? null,
        profileId: draft.profileId ?? null,
        kind: draft.kind,
        severity: draft.severity ?? 'info',
        title: draft.title,
        body: draft.body ?? null,
        href: draft.href ?? null,
        subjectType: draft.subjectType ?? null,
        subjectId: draft.subjectId ?? null,
        dedupeKey: draft.dedupeKey ?? null,
        data: draft.data ?? {},
        expiresAt: draft.expiresAt ?? null,
      })
      // `app_notifications_dedupe_key_uniq` is a PARTIAL unique index (`where
      // dedupe_key is not null`) — Postgres only infers a partial index for
      // ON CONFLICT when the target's WHERE matches the index predicate
      // exactly; a bare `target` alone 500s with "no unique or exclusion
      // constraint matching the ON CONFLICT specification" (found via the QA
      // stack run, see PR). Mirrored in scripts/qa/seed/inbox.ts.
      .onConflictDoNothing({ target: a.dedupeKey, where: sql`${a.dedupeKey} is not null` })
      .returning({ id: a.id });
    if (inserted) return inserted.id;
    if (!draft.dedupeKey) throw error(500, 'upsertNotification conflict without a dedupe key');
    const [existing] = await tx
      .select({ id: a.id })
      .from(a)
      .where(eq(a.dedupeKey, draft.dedupeKey))
      .limit(1);
    if (!existing) throw error(500, 'upsertNotification lost its conflicting row');
    return existing.id;
  });
}

/** Producer API: resolve every unresolved row for the given dedupe keys
 *  (I2 — the condition cleared). Returns the number of rows resolved. */
export async function resolveByKeys(ctx: CoreCtx, keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;
  return withOrgCore(ctx, async (tx) => {
    const rows = await tx
      .update(a)
      .set({ resolvedAt: new Date() })
      .where(and(inArray(a.dedupeKey, keys), isNull(a.resolvedAt)))
      .returning({ id: a.id });
    return rows.length;
  });
}
