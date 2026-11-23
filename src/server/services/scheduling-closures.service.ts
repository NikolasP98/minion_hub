/**
 * Spec 147 "Cerrar agenda": org-wide stretches of time nobody should book, with a
 * reason. One row per local day; one form submit = one `group_id`.
 */
import { and, eq, gt, lt, inArray, sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { schedClosures } from '$server/db/pg-scheduling-schema';
import { expandClosureDays, type ClosureInput } from '$server/scheduling/closures';
import {
  schedulingTimeZone,
  type CalendarClosure,
} from '$lib/components/scheduling/calendar-window';
import { listResources } from './scheduling.service';
import { recordAuditsInTx } from './activity.service';

export type { CalendarClosure };

export class ClosureError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid' | 'not_found',
  ) {
    super(message);
  }
}

/** Closures overlapping `[from, to)`. */
export async function listClosures(
  ctx: CoreCtx,
  range: { from: Date; to: Date },
): Promise<CalendarClosure[]> {
  return withOrgCore(ctx, async (tx) => {
    const rows = await tx
      .select()
      .from(schedClosures)
      .where(
        and(
          eq(schedClosures.orgId, ctx.tenantId),
          lt(schedClosures.startsAt, range.to),
          gt(schedClosures.endsAt, range.from),
        ),
      );
    if (!rows.length) return [];
    const sizes = await tx
      .select({ groupId: schedClosures.groupId, n: sql<number>`count(*)::int` })
      .from(schedClosures)
      .where(
        and(
          eq(schedClosures.orgId, ctx.tenantId),
          inArray(schedClosures.groupId, [...new Set(rows.map((r) => r.groupId))]),
        ),
      )
      .groupBy(schedClosures.groupId);
    const size = new Map(sizes.map((s) => [s.groupId, Number(s.n)]));
    return rows.map((r) => ({
      id: r.id,
      groupId: r.groupId,
      groupSize: size.get(r.groupId) ?? 1,
      start: r.startsAt.toISOString(),
      end: r.endsAt.toISOString(),
      reason: r.reason,
    }));
  });
}

/** One row per local day of the range, all in one transaction under one group. */
type Actor = { id: string | null; name: string | null };

export async function createClosures(
  ctx: CoreCtx,
  input: ClosureInput,
  actor: Actor,
): Promise<{ groupId: string; count: number }> {
  // The calendar's own timezone rule (calendar-window.ts `schedulingTimeZone`).
  const tz = schedulingTimeZone(await listResources(ctx));
  const plan = expandClosureDays(input, tz);
  if (!plan.ok) throw new ClosureError(plan.error, 'invalid');
  const groupId = crypto.randomUUID();
  await withOrgCore(ctx, async (tx) => {
    const rows = await tx
      .insert(schedClosures)
      .values(
        plan.days.map((d) => ({
          orgId: ctx.tenantId,
          startsAt: d.startsAt,
          endsAt: d.endsAt,
          reason: plan.reason,
          groupId,
          createdBy: ctx.profileId ?? null,
        })),
      )
      .returning();
    await recordAuditsInTx(
      tx,
      ctx,
      rows.map((r) => auditOf(r, 'create', actor)),
    );
  });
  return { groupId, count: plan.days.length };
}

/** Reopen one day, or (`group`) every day created with it. Returns rows removed. */
export function reopenClosure(ctx: CoreCtx, id: string, opts: { group?: boolean }, actor: Actor) {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .select({ groupId: schedClosures.groupId })
      .from(schedClosures)
      .where(and(eq(schedClosures.orgId, ctx.tenantId), eq(schedClosures.id, id)));
    if (!row) throw new ClosureError('closure not found', 'not_found');
    const removed = await tx
      .delete(schedClosures)
      .where(
        and(
          eq(schedClosures.orgId, ctx.tenantId),
          opts.group ? eq(schedClosures.groupId, row.groupId) : eq(schedClosures.id, id),
        ),
      )
      .returning();
    await recordAuditsInTx(
      tx,
      ctx,
      removed.map((r) => auditOf(r, 'delete', actor)),
    );
    return removed.length;
  });
}

function auditOf(r: typeof schedClosures.$inferSelect, op: 'create' | 'delete', actor: Actor) {
  const value = `${r.startsAt.toISOString()} – ${r.endsAt.toISOString()}: ${r.reason}`;
  return {
    refType: 'sched_closure',
    refId: r.id,
    op,
    changes: [
      {
        field: 'closure',
        label: 'Agenda cerrada',
        old: op === 'create' ? null : value,
        new: op === 'create' ? value : null,
      },
    ],
    actor,
  };
}
