import { and, eq, isNull } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import { finSources } from '$server/db/pg-finance-schema';
import { appNotifications } from '$server/db/pg-inbox-schema';
import type { CoreCtx } from '$server/auth/core-ctx';
import type { Rule, RuleResult } from './types';

/** Pure boundary check: the source's last recorded sync outcome was a
 *  failure. `finance.service.ts`'s `setSourceSync` only ever stores
 *  `'success' | 'failed'` into `lastStatus` (see `finance-sync.service.ts`
 *  call sites) — anything else (including null, never synced) is not a
 *  failure. Exported for the unit test. */
export function isSyncFailed(lastStatus: string | null): boolean {
  return lastStatus === 'failed';
}

// shortcut: see appointment-overdue.ts — fixed Spanish strings, no per-viewer locale.
function title(): string {
  return 'Sincronización de finanzas falló';
}
function body(provider: string): string {
  return `Proveedor ${provider} no sincronizó en el último intento`;
}

export const financeSyncFailedRule: Rule = {
  key: 'finance.sync_failed',
  async evaluate(ctx: CoreCtx, _now: Date): Promise<RuleResult> {
    return withOrgCore(ctx, async (tx) => {
      const sources = await tx
        .select({ provider: finSources.provider, lastStatus: finSources.lastStatus })
        .from(finSources)
        .where(and(eq(finSources.orgId, ctx.tenantId), eq(finSources.enabled, true)));

      const failing = sources.filter((s) => isSyncFailed(s.lastStatus));
      const upserts: RuleResult['upserts'] = failing.map((s) => ({
        scope: 'role',
        orgId: ctx.tenantId,
        capability: 'finance:manage',
        kind: 'finance.sync_failed',
        severity: 'critical',
        title: title(),
        body: body(s.provider),
        href: '/finance/settings',
        subjectType: 'fin_source',
        subjectId: s.provider,
        dedupeKey: `finance-sync-failed:${ctx.tenantId}:${s.provider}`,
      }));

      // Resolve: a previously-fired source resolves once it syncs
      // successfully again, or is disabled.
      const existing = await tx
        .select({ dedupeKey: appNotifications.dedupeKey, subjectId: appNotifications.subjectId })
        .from(appNotifications)
        .where(
          and(
            eq(appNotifications.kind, 'finance.sync_failed'),
            eq(appNotifications.orgId, ctx.tenantId),
            isNull(appNotifications.resolvedAt),
          ),
        );
      if (existing.length === 0) return { upserts, resolve: [] };

      const stillFailing = new Set(failing.map((s) => s.provider));
      const resolve = existing
        .filter((r) => !r.subjectId || !stillFailing.has(r.subjectId))
        .map((r) => r.dedupeKey)
        .filter((k): k is string => Boolean(k));
      return { upserts, resolve };
    });
  },
};
