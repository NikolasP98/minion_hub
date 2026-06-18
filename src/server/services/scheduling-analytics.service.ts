import { and, eq, inArray, gte, lte, sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import {
  schedResources,
  schedSchedules,
  schedAvailability,
  schedBookings,
} from '$server/db/pg-scheduling-schema';
import { availableMinutes } from '$server/scheduling/slots';
import type { ResourceAvailability } from '$server/scheduling/slots';

/**
 * Read-only analytics for the scheduling dashboard: per-staff utilization
 * (booked vs available minutes), summary KPIs, and the revenue/CRM overlay that
 * ties booked time to linked finance revenue.
 */

const MS_PER_DAY = 86_400_000;

export interface UtilizationDay {
  date: string; // 'YYYY-MM-DD'
  bookedMin: number;
  availableMin: number;
}

export interface ResourceUtilization {
  resourceId: string;
  name: string;
  color: string | null;
  bookedMin: number;
  availableMin: number;
  utilization: number; // 0..1
  bookingCount: number;
  days: UtilizationDay[];
}

/** Per-staff utilization across [from, to], with a per-day breakdown for the heatmap. */
export async function utilizationHeatmap(ctx: CoreCtx, from: Date, to: Date): Promise<ResourceUtilization[]> {
  return withOrgCore(ctx, async (tx) => {
    const resources = await tx
      .select()
      .from(schedResources)
      .where(and(eq(schedResources.orgId, ctx.tenantId), eq(schedResources.active, true)));
    if (!resources.length) return [];

    const scheds = await tx
      .select()
      .from(schedSchedules)
      .where(eq(schedSchedules.orgId, ctx.tenantId));
    const schedByResource = new Map<string, (typeof scheds)[number]>();
    for (const s of scheds) if (!schedByResource.has(s.resourceId)) schedByResource.set(s.resourceId, s);
    const rules = scheds.length
      ? await tx.select().from(schedAvailability).where(inArray(schedAvailability.scheduleId, scheds.map((s) => s.id)))
      : [];
    const rulesBySched = new Map<string, typeof rules>();
    for (const r of rules) {
      const list = rulesBySched.get(r.scheduleId) ?? [];
      list.push(r);
      rulesBySched.set(r.scheduleId, list);
    }

    const bookings = await tx
      .select({
        resourceId: schedBookings.resourceId,
        start: schedBookings.startTime,
        end: schedBookings.endTime,
      })
      .from(schedBookings)
      .where(
        and(
          eq(schedBookings.orgId, ctx.tenantId),
          inArray(schedBookings.status, ['accepted', 'completed']),
          gte(schedBookings.startTime, from),
          lte(schedBookings.startTime, to),
        ),
      );
    const bookedByResource = new Map<string, typeof bookings>();
    for (const b of bookings) {
      const list = bookedByResource.get(b.resourceId) ?? [];
      list.push(b);
      bookedByResource.set(b.resourceId, list);
    }

    // Day buckets across the range.
    const dayKeys: string[] = [];
    for (let t = Date.parse(from.toISOString().slice(0, 10) + 'T00:00:00Z'); t <= to.getTime(); t += MS_PER_DAY) {
      dayKeys.push(new Date(t).toISOString().slice(0, 10));
    }

    return resources.map((res) => {
      const sched = schedByResource.get(res.id);
      const ra: ResourceAvailability = {
        resourceId: res.id,
        timezone: sched?.timezone ?? res.timezone,
        rules: sched
          ? (rulesBySched.get(sched.id) ?? []).map((r) => ({ days: r.days, startTime: r.startTime, endTime: r.endTime, date: r.date }))
          : [],
      };
      const resBookings = bookedByResource.get(res.id) ?? [];
      const days: UtilizationDay[] = dayKeys.map((date) => {
        const dayStart = new Date(`${date}T00:00:00Z`);
        const dayEnd = new Date(dayStart.getTime() + MS_PER_DAY);
        const availableMin = availableMinutes(ra, dayStart, dayEnd);
        const bookedMin = resBookings
          .filter((b) => b.start >= dayStart && b.start < dayEnd)
          .reduce((sum, b) => sum + (b.end.getTime() - b.start.getTime()) / 60_000, 0);
        return { date, bookedMin, availableMin };
      });
      const bookedMin = days.reduce((s, d) => s + d.bookedMin, 0);
      const availableMin = days.reduce((s, d) => s + d.availableMin, 0);
      return {
        resourceId: res.id,
        name: res.name,
        color: res.color,
        bookedMin,
        availableMin,
        utilization: availableMin > 0 ? Math.min(1, bookedMin / availableMin) : 0,
        bookingCount: resBookings.length,
        days,
      };
    });
  });
}

export interface SchedulingSummary {
  upcoming: number;
  bookedThisRange: number;
  cancelled: number;
  noShow: number;
  resourceCount: number;
  eventTypeCount: number;
}

export async function schedulingSummary(ctx: CoreCtx, from: Date, to: Date): Promise<SchedulingSummary> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = (await tx.execute(sql`
      select
        count(*) filter (where status in ('accepted','pending') and start_time >= now()) as upcoming,
        count(*) filter (where status in ('accepted','completed') and start_time >= ${from} and start_time <= ${to}) as booked,
        count(*) filter (where status = 'cancelled' and start_time >= ${from} and start_time <= ${to}) as cancelled,
        count(*) filter (where status = 'no_show' and start_time >= ${from} and start_time <= ${to}) as no_show
      from sched_bookings where org_id = ${ctx.tenantId}
    `)) as unknown as Array<Record<string, unknown>>;
    const [counts] = (await tx.execute(sql`
      select
        (select count(*) from sched_resources where org_id = ${ctx.tenantId} and active) as resources,
        (select count(*) from sched_event_types where org_id = ${ctx.tenantId} and active) as event_types
    `)) as unknown as Array<Record<string, unknown>>;
    return {
      upcoming: Number(row?.upcoming ?? 0),
      bookedThisRange: Number(row?.booked ?? 0),
      cancelled: Number(row?.cancelled ?? 0),
      noShow: Number(row?.no_show ?? 0),
      resourceCount: Number(counts?.resources ?? 0),
      eventTypeCount: Number(counts?.event_types ?? 0),
    };
  });
}

export interface ResourceRevenue {
  resourceId: string;
  name: string;
  bookings: number;
  /** Revenue from finance invoices linked (via CRM contact) to this staff's appointments. */
  linkedRevenue: number;
}

/**
 * Revenue/CRM overlay: for each staff, sum finance revenue of invoices belonging
 * to the CRM contacts they've seen in [from, to]. Soft-joins sched_bookings →
 * crm_contacts (crm_contact_id) → crm_contact_identities (phone) → fin_invoices
 * (last-9-digit phone match, the established crm-finance bridge). Returns [] if
 * the CRM/finance tables aren't present.
 */
export async function revenueByResource(ctx: CoreCtx, from: Date, to: Date): Promise<ResourceRevenue[]> {
  return withOrgCore(ctx, async (tx) => {
    try {
      const rows = (await tx.execute(sql`
        with seen as (
          select b.resource_id, b.crm_contact_id, count(*)::int as bookings
          from sched_bookings b
          where b.org_id = ${ctx.tenantId} and b.start_time >= ${from} and b.start_time <= ${to}
            and b.status in ('accepted','completed')
          group by b.resource_id, b.crm_contact_id
        ),
        phones as (
          select ci.contact_id,
                 right(regexp_replace(coalesce(ci.external_id,''),'\\D','','g'), 9) as p9
          from crm_contact_identities ci
          where ci.org_id = ${ctx.tenantId} and ci.channel = 'whatsapp'
            and length(regexp_replace(coalesce(ci.external_id,''),'\\D','','g')) >= 8
        ),
        contact_rev as (
          select ph.contact_id, coalesce(sum(fi.total),0)::float8 as revenue
          from phones ph
          join fin_invoices fi
            on fi.org_id = ${ctx.tenantId}
           and right(regexp_replace(coalesce(fi.client_doc_number,''),'\\D','','g'), 9) = ph.p9
          group by ph.contact_id
        )
        select r.id as resource_id, r.name,
               coalesce(sum(seen.bookings),0)::int as bookings,
               coalesce(sum(case when seen.crm_contact_id is not null then cr.revenue else 0 end),0)::float8 as revenue
        from sched_resources r
        left join seen on seen.resource_id = r.id
        left join contact_rev cr on cr.contact_id = seen.crm_contact_id
        where r.org_id = ${ctx.tenantId} and r.active
        group by r.id, r.name
        order by revenue desc, r.name
      `)) as unknown as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        resourceId: String(r.resource_id),
        name: String(r.name),
        bookings: Number(r.bookings ?? 0),
        linkedRevenue: Number(r.revenue ?? 0),
      }));
    } catch {
      return [];
    }
  });
}
