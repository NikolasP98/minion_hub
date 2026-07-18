import { sql, eq, and } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
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

export async function listPending(ctx: CoreCtx): Promise<PulseProposalRow[]> {
  return withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(pulseProposals)
      .where(and(eq(pulseProposals.orgId, ctx.tenantId), eq(pulseProposals.status, 'pending')))
      .orderBy(sql`${pulseProposals.createdAt} desc`),
  );
}

export async function countPending(ctx: CoreCtx): Promise<number> {
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(pulseProposals)
      .where(and(eq(pulseProposals.orgId, ctx.tenantId), eq(pulseProposals.status, 'pending'))),
  );
  return rows[0]?.n ?? 0;
}

export async function markApproved(ctx: CoreCtx, id: string, by: string) {
  return withOrgCore(ctx, (tx) =>
    tx
      .update(pulseProposals)
      .set({ status: 'approved', decidedBy: by })
      .where(and(eq(pulseProposals.orgId, ctx.tenantId), eq(pulseProposals.id, id))),
  );
}

export async function dismiss(ctx: CoreCtx, id: string, by: string) {
  return withOrgCore(ctx, (tx) =>
    tx
      .update(pulseProposals)
      .set({ status: 'dismissed', decidedBy: by })
      .where(and(eq(pulseProposals.orgId, ctx.tenantId), eq(pulseProposals.id, id))),
  );
}

export async function editPayload(ctx: CoreCtx, id: string, args: Record<string, unknown>) {
  return withOrgCore(ctx, (tx) =>
    tx
      .update(pulseProposals)
      .set({ payload: sql`jsonb_set(${pulseProposals.payload}, '{args}', ${JSON.stringify(args)}::jsonb)` })
      .where(and(eq(pulseProposals.orgId, ctx.tenantId), eq(pulseProposals.id, id))),
  );
}

export async function getProposal(ctx: CoreCtx, id: string): Promise<PulseProposalRow | null> {
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(pulseProposals)
      .where(and(eq(pulseProposals.orgId, ctx.tenantId), eq(pulseProposals.id, id)))
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
  return rows[0] ?? ({ orgId: ctx.tenantId, ...DEFAULT_SETTINGS, updatedAt: new Date() } as PulseSettingsRow);
}

export async function saveSettings(ctx: CoreCtx, patch: Partial<typeof DEFAULT_SETTINGS>) {
  return withOrgCore(ctx, (tx) =>
    tx
      .insert(pulseSettings)
      .values({ orgId: ctx.tenantId, ...DEFAULT_SETTINGS, ...patch, updatedAt: new Date() })
      .onConflictDoUpdate({ target: pulseSettings.orgId, set: { ...patch, updatedAt: new Date() } }),
  );
}
