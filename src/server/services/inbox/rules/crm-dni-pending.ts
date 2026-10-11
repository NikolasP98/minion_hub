import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import { parties } from '$server/db/pg-party-schema';
import { appNotifications } from '$server/db/pg-inbox-schema';
import type { CoreCtx } from '$server/auth/core-ctx';
import type { Rule, RuleResult } from './types';

const STALE_MS = 2 * 24 * 60 * 60 * 1000;

/** Pure boundary check: still-pending since `now` is at least 2 days past
 *  `since` (createdAt, for a party never even attempted; or
 *  `metadata.dni_validation.checked_at`, for one stuck mid-check — see
 *  `isDniPending`). Exported for the unit test. */
export function isPendingTooLong(since: Date, now: Date, thresholdMs = STALE_MS): boolean {
  return now.getTime() - since.getTime() >= thresholdMs;
}

/** Pure predicate mirroring `party.service.ts`'s own DNI-pending check
 *  (~L666-676): a party counts as "awaiting DNI validation" when its
 *  `docNumber` looks like a DNI (8 digits), it isn't verified yet, and
 *  there's no terminal `metadata.dni_validation.status` (null = never
 *  attempted, 'processing' = attempted but not resolved). Exported for the
 *  unit test — there is no dedicated typed status column, only this jsonb
 *  shape, so the predicate is the spec. */
export function isDniPending(
  docNumber: string | null,
  dniVerified: boolean,
  validationStatus: string | null | undefined,
): boolean {
  if (dniVerified) return false;
  if (!docNumber || !/^\d{8}$/.test(docNumber)) return false;
  return validationStatus == null || validationStatus === 'processing';
}

// shortcut: see appointment-overdue.ts — fixed Spanish strings, no per-viewer locale.
function title(): string {
  return 'DNI pendiente de validar';
}
function body(name: string | null, docNumber: string): string {
  return `${name ?? '—'} · ${docNumber}`;
}

export const crmDniPendingRule: Rule = {
  key: 'crm.dni_pending',
  async evaluate(ctx: CoreCtx, now: Date): Promise<RuleResult> {
    return withOrgCore(ctx, async (tx) => {
      const candidates = await tx
        .select({
          id: parties.id,
          name: parties.name,
          docNumber: parties.docNumber,
          dniVerified: parties.dniVerified,
          createdAt: parties.createdAt,
          validationStatus: sql<
            string | null
          >`${parties.metadata} -> 'dni_validation' ->> 'status'`,
          checkedAt: sql<string | null>`${parties.metadata} -> 'dni_validation' ->> 'checked_at'`,
        })
        .from(parties)
        .where(and(eq(parties.orgId, ctx.tenantId), eq(parties.dniVerified, false)));

      const upserts: RuleResult['upserts'] = [];
      for (const p of candidates) {
        if (!isDniPending(p.docNumber, p.dniVerified, p.validationStatus)) continue;
        const since = p.checkedAt ? new Date(p.checkedAt) : p.createdAt;
        if (!isPendingTooLong(since, now)) continue;
        upserts.push({
          scope: 'role',
          orgId: ctx.tenantId,
          capability: 'crm:manage',
          kind: 'crm.dni_pending',
          severity: 'info',
          title: title(),
          body: body(p.name, p.docNumber!),
          href: `/crm/contacts?party=${p.id}`,
          subjectType: 'party',
          subjectId: p.id,
          dedupeKey: `crm-dni-pending:${ctx.tenantId}:${p.id}`,
        });
      }

      // Resolve: a previously-fired party resolves once it's verified, the
      // validation reaches a terminal (non-pending) status, or the document
      // number no longer looks like a DNI.
      const existing = await tx
        .select({ dedupeKey: appNotifications.dedupeKey, subjectId: appNotifications.subjectId })
        .from(appNotifications)
        .where(
          and(
            eq(appNotifications.kind, 'crm.dni_pending'),
            eq(appNotifications.orgId, ctx.tenantId),
            isNull(appNotifications.resolvedAt),
          ),
        );
      if (existing.length === 0) return { upserts, resolve: [] };

      const partyIds = [...new Set(existing.map((r) => r.subjectId).filter(Boolean))] as string[];
      const rows = await tx
        .select({
          id: parties.id,
          docNumber: parties.docNumber,
          dniVerified: parties.dniVerified,
          validationStatus: sql<
            string | null
          >`${parties.metadata} -> 'dni_validation' ->> 'status'`,
        })
        .from(parties)
        .where(inArray(parties.id, partyIds));
      const byId = new Map(rows.map((r) => [r.id, r]));

      const resolve = existing
        .filter((r) => {
          const party = r.subjectId ? byId.get(r.subjectId) : undefined;
          return (
            !party || !isDniPending(party.docNumber, party.dniVerified, party.validationStatus)
          );
        })
        .map((r) => r.dedupeKey)
        .filter((k): k is string => Boolean(k));
      return { upserts, resolve };
    });
  },
};
