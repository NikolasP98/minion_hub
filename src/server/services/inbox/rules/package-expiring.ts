import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import { posPackageGrants, posPackageRedemptions } from '$server/db/pg-pos-schema';
import { appNotifications } from '$server/db/pg-inbox-schema';
import {
  isExpired,
  sessionsRemaining,
  expiryFrom,
  grantToday,
} from '$server/services/pos-accounts.logic';
import { resolveOrgTimezone } from '$server/services/inbox/daily-feed.service';
import type { CoreCtx } from '$server/auth/core-ctx';
import type { Rule, RuleResult } from './types';

const WINDOW_DAYS = 7;

/** Pure boundary check: a grant is "expiring soon" when its expiry falls on
 *  or before `today + windowDays` and it hasn't already expired (day-key
 *  string comparisons, same convention as `isExpired`/`expiryFrom` in
 *  pos-accounts.logic.ts). Exported for the unit test. */
export function isExpiringSoon(
  expiresAt: string | null,
  today: string,
  windowDays = WINDOW_DAYS,
): boolean {
  if (expiresAt == null) return false;
  if (isExpired(expiresAt, today)) return false;
  const windowEnd = expiryFrom(today, windowDays);
  return windowEnd != null && expiresAt <= windowEnd;
}

// shortcut: see appointment-overdue.ts — fixed Spanish strings, no per-viewer locale.
function title(): string {
  return 'Paquete por vencer';
}
function body(expiresAt: string, remaining: number): string {
  return `${remaining} sesión(es) restantes · vence ${expiresAt}`;
}

/** Non-reversed-redemption count + remaining sessions, one grant at a time —
 *  shared by the upsert scan and the resolve re-check. */
async function usedCount(tx: CoreTx, grantId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(posPackageRedemptions)
    .where(
      and(eq(posPackageRedemptions.grantId, grantId), isNull(posPackageRedemptions.reversedAt)),
    );
  return row?.n ?? 0;
}

export const packageExpiringRule: Rule = {
  key: 'package.expiring',
  async evaluate(ctx: CoreCtx, now: Date): Promise<RuleResult> {
    const tz = await resolveOrgTimezone(ctx);
    const today = grantToday(tz, now);

    return withOrgCore(ctx, async (tx) => {
      const grants = await tx
        .select({
          id: posPackageGrants.id,
          sessionsTotal: posPackageGrants.sessionsTotal,
          expiresAt: posPackageGrants.expiresAt,
          crmContactId: posPackageGrants.crmContactId,
        })
        .from(posPackageGrants)
        .where(
          and(
            eq(posPackageGrants.orgId, ctx.tenantId),
            eq(posPackageGrants.status, 'active'),
            sql`${posPackageGrants.expiresAt} is not null`,
          ),
        );

      const upserts: RuleResult['upserts'] = [];
      for (const g of grants) {
        if (!isExpiringSoon(g.expiresAt, today)) continue;
        const used = await usedCount(tx, g.id);
        const remaining = sessionsRemaining(g.sessionsTotal, used);
        if (remaining <= 0) continue;
        upserts.push({
          scope: 'role',
          orgId: ctx.tenantId,
          capability: 'pos:manage',
          kind: 'package.expiring',
          severity: 'warning',
          title: title(),
          body: body(g.expiresAt!, remaining),
          href: `/pos/accounts?grant=${g.id}`,
          subjectType: 'pos_package_grant',
          subjectId: g.id,
          dedupeKey: `package-expiring:${ctx.tenantId}:${g.id}`,
        });
      }

      // Resolve: a previously-fired grant resolves once it's exhausted,
      // cancelled, or no longer inside the expiring-soon window (either
      // already expired, or — not possible for a fixed expiresAt, but kept
      // symmetric with the forward check for a future edit to the grant).
      const existing = await tx
        .select({ dedupeKey: appNotifications.dedupeKey, subjectId: appNotifications.subjectId })
        .from(appNotifications)
        .where(
          and(
            eq(appNotifications.kind, 'package.expiring'),
            eq(appNotifications.orgId, ctx.tenantId),
            isNull(appNotifications.resolvedAt),
          ),
        );
      if (existing.length === 0) return { upserts, resolve: [] };

      const grantIds = [...new Set(existing.map((r) => r.subjectId).filter(Boolean))] as string[];
      const rows = await tx
        .select({
          id: posPackageGrants.id,
          sessionsTotal: posPackageGrants.sessionsTotal,
          expiresAt: posPackageGrants.expiresAt,
          status: posPackageGrants.status,
        })
        .from(posPackageGrants)
        .where(inArray(posPackageGrants.id, grantIds));
      const byId = new Map(rows.map((r) => [r.id, r]));

      const resolve: string[] = [];
      for (const r of existing) {
        if (!r.dedupeKey) continue;
        const grant = r.subjectId ? byId.get(r.subjectId) : undefined;
        if (!grant || grant.status !== 'active' || !isExpiringSoon(grant.expiresAt, today)) {
          resolve.push(r.dedupeKey);
          continue;
        }
        const used = await usedCount(tx, grant.id);
        if (sessionsRemaining(grant.sessionsTotal, used) <= 0) resolve.push(r.dedupeKey);
      }
      return { upserts, resolve };
    });
  },
};
