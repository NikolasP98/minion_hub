import { and, eq, isNull, sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import { parties } from '$server/db/pg-party-schema';
import { appNotifications } from '$server/db/pg-inbox-schema';
import { resolveOrgTimezone, orgLocalDateString } from '$server/services/inbox/daily-feed.service';
import type { CoreCtx } from '$server/auth/core-ctx';
import type { Rule, RuleResult } from './types';

/** Pure boundary check: `dob`'s month-day matches `today`'s (both
 *  'YYYY-MM-DD') — the year is irrelevant, only the anniversary matters.
 *  Exported for the unit test.
 *
 *  shortcut: a Feb-29 `dob` never matches in a non-leap year (string
 *  comparison, no Feb-28/Mar-1 fallback) — upgrade only if a real contact
 *  with that birth date reports missing their notification. */
export function isBirthdayToday(dob: string | null, today: string): boolean {
  if (!dob) return false;
  return dob.slice(5) === today.slice(5);
}

// shortcut: see appointment-overdue.ts — fixed Spanish strings, no per-viewer locale.
function title(): string {
  return 'Cumpleaños hoy';
}
function body(names: string[]): string {
  return names.join(', ');
}

export const crmBirthdayRule: Rule = {
  key: 'crm.birthday',
  async evaluate(ctx: CoreCtx, now: Date): Promise<RuleResult> {
    const tz = await resolveOrgTimezone(ctx);
    const today = orgLocalDateString(tz, now);

    return withOrgCore(ctx, async (tx) => {
      const candidates = await tx
        .select({ id: parties.id, name: parties.name, dob: parties.dob })
        .from(parties)
        .where(and(eq(parties.orgId, ctx.tenantId), sql`${parties.dob} is not null`));

      const birthdays = candidates.filter((p) => isBirthdayToday(p.dob, today));
      const dedupeKey = `crm-birthday:${ctx.tenantId}:${today}`;
      const upserts: RuleResult['upserts'] =
        birthdays.length === 0
          ? []
          : [
              {
                scope: 'org',
                orgId: ctx.tenantId,
                kind: 'crm.birthday',
                severity: 'info',
                title: title(),
                body: body(birthdays.map((p) => p.name ?? '—')),
                href: '/crm/contacts',
                subjectType: 'org_day',
                subjectId: today,
                dedupeKey,
              },
            ];

      // Resolve: yesterday's (or earlier) birthday row — the dedupe key
      // carries the date, so a previous day's row is never re-matched by
      // today's upsert; it resolves once the date it names is no longer today.
      const existing = await tx
        .select({ dedupeKey: appNotifications.dedupeKey, subjectId: appNotifications.subjectId })
        .from(appNotifications)
        .where(
          and(
            eq(appNotifications.kind, 'crm.birthday'),
            eq(appNotifications.orgId, ctx.tenantId),
            isNull(appNotifications.resolvedAt),
          ),
        );
      const resolve = existing
        .filter((r) => r.subjectId !== today)
        .map((r) => r.dedupeKey)
        .filter((k): k is string => Boolean(k));
      return { upserts, resolve };
    });
  },
};
