import { and, eq, ne, sql } from 'drizzle-orm';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { posSettings, posShifts, posTickets, posPayments, type PosShift } from '$server/db/pg-pos-schema';

export class PosError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'PosError';
  }
}

export interface Actor {
  id: string | null;
  name: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---- settings ----

export interface PosSettings {
  methods: string[];
  currency: string;
  requireCustomer: boolean;
  allowPriceOverride: boolean;
}

// Frozen (incl. the methods array) so a stray in-place mutation throws instead
// of silently corrupting defaults for every org in the process.
export const DEFAULT_POS_SETTINGS: PosSettings = Object.freeze({
  methods: Object.freeze(['cash', 'card', 'yape', 'plin', 'transfer']) as string[],
  currency: 'PEN',
  requireCustomer: false,
  allowPriceOverride: true,
});

export async function getPosSettings(ctx: CoreCtx): Promise<PosSettings> {
  const [row] = await withOrgCore(ctx, (tx) => tx.select().from(posSettings).where(eq(posSettings.orgId, ctx.tenantId)).limit(1));
  // Defensive copy — callers get a mutable object, never the shared singleton.
  if (!row) return { ...DEFAULT_POS_SETTINGS, methods: [...DEFAULT_POS_SETTINGS.methods] };
  return {
    methods: row.methods as string[],
    currency: row.currency,
    requireCustomer: row.requireCustomer,
    allowPriceOverride: row.allowPriceOverride,
  };
}

export async function updatePosSettings(ctx: CoreCtx, patch: Partial<PosSettings>): Promise<PosSettings> {
  const current = await getPosSettings(ctx);
  const next: PosSettings = { ...current, ...patch };
  if (!Array.isArray(next.methods) || next.methods.length === 0 || next.methods.some((m) => typeof m !== 'string' || m !== m.toLowerCase() || m.length === 0)) {
    throw new PosError('methods must be a non-empty array of non-empty lowercase strings', 'invalid_methods');
  }
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .insert(posSettings)
      .values({ orgId: ctx.tenantId, ...next })
      .onConflictDoUpdate({ target: posSettings.orgId, set: { ...next, updatedAt: new Date() } })
      .returning(),
  );
  return {
    methods: row.methods as string[],
    currency: row.currency,
    requireCustomer: row.requireCustomer,
    allowPriceOverride: row.allowPriceOverride,
  };
}

// ---- shifts ----

export interface ShiftSummary {
  ticketCount: number;
  voidCount: number;
  gross: number;
  byMethod: Record<string, number>;
}

const NON_VOID = ne(posTickets.status, 'void');

/**
 * Expected drawer amounts at close: per-method payment sums, plus the opening
 * float folded into cash ONLY (per the brief — the physical drawer starts with
 * a float; electronic methods have no starting balance to reconcile).
 * Pure, so the math is unit-testable without a db.
 */
export function computeExpected(byMethod: Record<string, number>, openingFloat: Record<string, number>): Record<string, number> {
  const expected = { ...byMethod };
  expected.cash = round2((expected.cash ?? 0) + Number(openingFloat.cash ?? 0));
  return expected;
}

/** Per-method payment sums, joined to non-void tickets, for one shift. */
async function paymentsByMethod(tx: CoreTx, orgId: string, shiftId: string): Promise<Record<string, number>> {
  const rows = await tx
    .select({ method: posPayments.method, amount: posPayments.amount })
    .from(posPayments)
    .innerJoin(posTickets, eq(posTickets.id, posPayments.ticketId))
    .where(and(eq(posPayments.orgId, orgId), eq(posPayments.shiftId, shiftId), NON_VOID));
  const byMethod: Record<string, number> = {};
  for (const r of rows) {
    byMethod[r.method] = round2((byMethod[r.method] ?? 0) + Number(r.amount));
  }
  return byMethod;
}

export async function getOpenShift(ctx: CoreCtx): Promise<{ shift: PosShift; summary: ShiftSummary } | null> {
  const [shift] = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(posShifts)
      .where(and(eq(posShifts.orgId, ctx.tenantId), eq(posShifts.status, 'open')))
      .limit(1),
  );
  if (!shift) return null;
  const summary = await shiftSummary(ctx, shift.id);
  return { shift, summary };
}

export async function openShift(ctx: CoreCtx, input: { openingFloat: Record<string, number>; actor: Actor }): Promise<PosShift> {
  return withOrgCore(ctx, async (tx) => {
    const [existing] = await tx
      .select({ id: posShifts.id })
      .from(posShifts)
      .where(and(eq(posShifts.orgId, ctx.tenantId), eq(posShifts.status, 'open')))
      .limit(1);
    if (existing) throw new PosError('a shift is already open for this org', 'shift_already_open');

    const [shift] = await tx
      .insert(posShifts)
      .values({ orgId: ctx.tenantId, openedBy: input.actor.id, openingFloat: input.openingFloat })
      .returning();
    return shift;
  });
}

export async function closeShift(ctx: CoreCtx, input: { counted: Record<string, number>; note?: string | null; actor: Actor }): Promise<PosShift> {
  return withOrgCore(ctx, async (tx) => {
    const [open] = await tx
      .select()
      .from(posShifts)
      .where(and(eq(posShifts.orgId, ctx.tenantId), eq(posShifts.status, 'open')))
      .limit(1);
    if (!open) throw new PosError('no open shift for this org', 'no_open_shift');

    const byMethod = await paymentsByMethod(tx, ctx.tenantId, open.id);
    const expected = computeExpected(byMethod, (open.openingFloat as Record<string, number>) ?? {});

    const [closed] = await tx
      .update(posShifts)
      .set({
        status: 'closed',
        closedBy: input.actor.id,
        closedAt: new Date(),
        expected,
        counted: input.counted,
        note: input.note ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(posShifts.id, open.id), eq(posShifts.orgId, ctx.tenantId)))
      .returning();
    return closed;
  });
}

export function listShifts(ctx: CoreCtx, opts: { limit?: number } = {}): Promise<PosShift[]> {
  return withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(posShifts)
      .where(eq(posShifts.orgId, ctx.tenantId))
      .orderBy(sql`${posShifts.openedAt} desc`)
      .limit(opts.limit ?? 100),
  );
}

export async function shiftSummary(ctx: CoreCtx, shiftId: string): Promise<ShiftSummary> {
  return withOrgCore(ctx, async (tx) => {
    const byMethod = await paymentsByMethod(tx, ctx.tenantId, shiftId);
    const tickets = await tx
      .select({ status: posTickets.status, total: posTickets.total })
      .from(posTickets)
      .where(and(eq(posTickets.orgId, ctx.tenantId), eq(posTickets.shiftId, shiftId)));

    let gross = 0;
    let voidCount = 0;
    for (const t of tickets) {
      if (t.status === 'void') voidCount++;
      else gross = round2(gross + Number(t.total));
    }
    return { ticketCount: tickets.length, voidCount, gross, byMethod };
  });
}
