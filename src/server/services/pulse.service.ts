import { sql, eq, and, desc, or, lt } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import {
  pulseOwnerPredicate,
  getPulseReceipt,
  decidePulseProposal,
  editPulseProposal,
} from './pulse-dispatch.store';
export { getPulseReceipt, decidePulseProposal, editPulseProposal };
import type { CoreCtx } from '$server/auth/core-ctx';
import {
  pulseProposals,
  pulseSettings,
  type PulseProposalRow,
  type PulseSettingsRow,
} from '$server/db/pg-schema/pulse';

export type ProposalInput = {
  source: string;
  kind: string;
  title: string;
  summary?: string;
  payload?: Record<string, unknown>;
  dedupKey: string;
};

/** Insert proposal cards, skipping any that already exist for (org_id, dedup_key).
 *  Idempotent — safe to re-run the same batch (e.g. a retried cron tick). */
export async function upsertProposals(ctx: CoreCtx, cards: ProposalInput[]) {
  if (!cards.length) return { inserted: 0, skipped: 0 };
  return withOrgCore(ctx, async (tx) => {
    const rows = cards.map((c) => ({
      orgId: ctx.tenantId,
      source: c.source,
      kind: c.kind,
      title: c.title,
      summary: c.summary ?? null,
      payload: c.payload ?? {},
      dedupKey: c.dedupKey,
    }));
    const res = await tx
      .insert(pulseProposals)
      .values(rows)
      .onConflictDoNothing({ target: [pulseProposals.orgId, pulseProposals.dedupKey] })
      .returning({ id: pulseProposals.id });
    return { inserted: res.length, skipped: cards.length - res.length };
  });
}

export const pulseSafeColumns = {
  id: pulseProposals.id,
  orgId: pulseProposals.orgId,
  createdAt: pulseProposals.createdAt,
  source: pulseProposals.source,
  kind: pulseProposals.kind,
  title: pulseProposals.title,
  summary: pulseProposals.summary,
  payload: pulseProposals.payload,
  status: pulseProposals.status,
  revision: pulseProposals.revision,
  ownerProfileId: pulseProposals.ownerProfileId,
  decidedAt: pulseProposals.decidedAt,
};
export type PulseProposalView = { [K in keyof typeof pulseSafeColumns]: PulseProposalRow[K] };
export async function listPending(ctx: CoreCtx): Promise<PulseProposalView[]> {
  return withOrgCore(ctx, (tx) =>
    tx
      .select(pulseSafeColumns)
      .from(pulseProposals)
      .where(
        and(
          eq(pulseProposals.orgId, ctx.tenantId),
          eq(pulseProposals.status, 'pending'),
          pulseOwnerPredicate(ctx),
        ),
      )
      .orderBy(sql`${pulseProposals.createdAt} desc`),
  );
}

export async function countPending(ctx: CoreCtx): Promise<number> {
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(pulseProposals)
      .where(
        and(
          eq(pulseProposals.orgId, ctx.tenantId),
          eq(pulseProposals.status, 'pending'),
          pulseOwnerPredicate(ctx),
        ),
      ),
  );
  return rows[0]?.n ?? 0;
}

/** Compatibility names retain atomic decision semantics; no unconditional writes remain. */
export const markApproved = (ctx: CoreCtx, id: string, _by: string, expectedRevision?: number) =>
  decidePulseProposal(ctx, id, 'approve', expectedRevision);
export const dismiss = (ctx: CoreCtx, id: string, _by: string, expectedRevision?: number) =>
  decidePulseProposal(ctx, id, 'dismiss', expectedRevision);
export const editPayload = editPulseProposal;

export async function getProposal(ctx: CoreCtx, id: string): Promise<PulseProposalRow | null> {
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(pulseProposals)
      .where(
        and(
          eq(pulseProposals.orgId, ctx.tenantId),
          eq(pulseProposals.id, id),
          pulseOwnerPredicate(ctx),
        ),
      )
      .limit(1),
  );
  return rows[0] ?? null;
}

const DEFAULT_SETTINGS = {
  enabled: false,
  briefingTime: '08:00',
  locale: 'es',
  channels: ['whatsapp'],
  watch: { email: true, whatsapp: true, calendar: true },
  autoApprove: {},
};

export async function getSettings(ctx: CoreCtx): Promise<PulseSettingsRow> {
  const rows = await withOrgCore(ctx, (tx) =>
    tx.select().from(pulseSettings).where(eq(pulseSettings.orgId, ctx.tenantId)).limit(1),
  );
  return (
    rows[0] ??
    ({ orgId: ctx.tenantId, ...DEFAULT_SETTINGS, updatedAt: new Date() } as PulseSettingsRow)
  );
}

export async function saveSettings(ctx: CoreCtx, patch: Partial<typeof DEFAULT_SETTINGS>) {
  return withOrgCore(ctx, (tx) =>
    tx
      .insert(pulseSettings)
      .values({ orgId: ctx.tenantId, ...DEFAULT_SETTINGS, ...patch, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: pulseSettings.orgId,
        set: { ...patch, updatedAt: new Date() },
      }),
  );
}

/** Bounded keyset history; pending feed/count semantics stay unchanged. */
export async function listRecentPulseDecisions(
  ctx: CoreCtx,
  input: { limit?: number; cursor?: { decidedAt: string | null; id: string } } = {},
) {
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Invalid receipt limit');
  const cursorDate = input.cursor?.decidedAt ? new Date(input.cursor.decidedAt) : undefined;
  if (cursorDate && !Number.isFinite(cursorDate.getTime()))
    throw new Error('Invalid receipt cursor');
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(pulseProposals)
      .where(
        and(
          eq(pulseProposals.orgId, ctx.tenantId),
          pulseOwnerPredicate(ctx),
          sql`${pulseProposals.status}<>'pending'`,
          ...(input.cursor
            ? [
                cursorDate
                  ? or(
                      lt(pulseProposals.decidedAt, cursorDate),
                      sql`${pulseProposals.decidedAt} is null`,
                      and(
                        eq(pulseProposals.decidedAt, cursorDate),
                        lt(pulseProposals.id, input.cursor.id),
                      ),
                    )
                  : and(
                      sql`${pulseProposals.decidedAt} is null`,
                      lt(pulseProposals.id, input.cursor.id),
                    ),
              ]
            : []),
        ),
      )
      .orderBy(sql`${pulseProposals.decidedAt} desc nulls last`, desc(pulseProposals.id))
      .limit(limit),
  );
  return Promise.all(
    rows.map(async (row) => ({ title: row.title, ...(await getPulseReceipt(ctx, row.id)) })),
  );
}
