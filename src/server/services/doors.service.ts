import { and, asc, eq, sql } from 'drizzle-orm';
import { getCoreDb } from '$server/db/pg-client';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { crmDoors, type CrmDoor } from '$server/db/pg-doors-schema';
import { schedLinks } from '$server/db/pg-scheduling-schema';
import { isModuleEnabled } from './modules.service';
import { orgLocalDateString, resolveOrgTimezone } from './inbox/daily-feed.service';
import { zonedDayWindow } from '$lib/components/dashboard/date-range/url';
import { isUniqueViolation } from './pos/db-errors';
import { getDoorKind } from '$lib/doors/kinds';
import type { DoorKind, DoorListRow, DoorRow } from '$lib/doors/types';

/**
 * Collection points ("doors", spec 041 S0): registry, public resolution,
 * anonymous counters and the Doors-view funnel.
 *
 * SECURITY BOUNDARY (same as scheduling-public.service): the public page has no
 * session, so `resolvePublicDoor` reads slug → org through the bypass-RLS
 * `getCoreDb()`. That one lookup only selects WHICH org; everything after it
 * runs through a CoreCtx for that org inside `withOrgCore`, so forced RLS
 * isolates it like an authenticated request. Door slugs are globally unique,
 * so — unlike /book (R11) — there is never an ambiguous org.
 */

export const DOOR_SLUG_RE = /^[a-z0-9][a-z0-9-]{2,62}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Typed failure the API routes map to `{ error: code, issues? }` with `status`. */
export class DoorError extends Error {
  constructor(
    public readonly code: 'unknown_kind' | 'slug_taken' | 'invalid_config' | 'invalid_range',
    public readonly status: 400 | 409,
    public readonly issues?: unknown,
  ) {
    super(code);
  }
}

function toRow(d: CrmDoor): DoorRow {
  return {
    id: d.id,
    orgId: d.orgId,
    kind: d.kind as DoorKind,
    slug: d.slug,
    title: d.title,
    description: d.description,
    active: d.active,
    config: d.config,
    followUp: d.followUp,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

const uniqueViolation = (e: unknown) =>
  isUniqueViolation(e) || isUniqueViolation((e as { cause?: unknown } | null)?.cause);

/** Active door by slug → org-scoped ctx. Null when unknown, off, or the CRM module is off. */
export async function resolvePublicDoor(
  slug: string,
): Promise<{ ctx: CoreCtx; door: DoorRow } | null> {
  if (!DOOR_SLUG_RE.test(slug)) return null;
  const db = getCoreDb();
  const [hit] = await db
    .select({ id: crmDoors.id, orgId: crmDoors.orgId })
    .from(crmDoors)
    .where(and(eq(crmDoors.slug, slug), eq(crmDoors.active, true)))
    .limit(1);
  if (!hit) return null;
  const ctx: CoreCtx = { db, tenantId: hit.orgId };
  if (!(await isModuleEnabled(ctx, 'crm'))) return null;
  // Re-read under the org's RLS: the bypass read above only chose the org.
  const door = await getDoor(ctx, hit.id);
  return door?.active ? { ctx, door } : null;
}

/**
 * +1 on today's anonymous counter for `doorKey` (`door:<id>` | `book:<id>`).
 * Fail-soft: a counter must never break the page or the submission.
 */
export async function bumpDoorStat(
  ctx: CoreCtx,
  doorKey: string,
  field: 'views' | 'submissions' | 'clicks',
  now: Date = new Date(),
): Promise<void> {
  const views = field === 'views' ? 1 : 0;
  const submissions = field === 'submissions' ? 1 : 0;
  const clicks = field === 'clicks' ? 1 : 0;
  try {
    // The org's business day, so a 23:30 Lima visit counts on the Lima day.
    const day = orgLocalDateString(await resolveOrgTimezone(ctx), now);
    await withOrgCore(ctx, (tx) =>
      tx.execute(sql`
        insert into crm_door_stats_daily (org_id, door_key, day, views, submissions, clicks)
        values (${ctx.tenantId}, ${doorKey}, ${day}::date, ${views}, ${submissions}, ${clicks})
        on conflict (org_id, door_key, day) do update set
          views = crm_door_stats_daily.views + excluded.views,
          submissions = crm_door_stats_daily.submissions + excluded.submissions,
          clicks = crm_door_stats_daily.clicks + excluded.clicks
      `),
    );
  } catch (e) {
    console.warn('[doors] stat bump failed', doorKey, field, (e as Error)?.message);
  }
}

const BOT_UA =
  /bot|crawl|spider|slurp|facebookexternalhit|facebookcatalog|whatsapp|telegram|slack|discord|linkedin|embedly|preview|curl|wget|python-requests|httpclient|go-http|okhttp|axios|node-fetch|lighthouse|pingdom|uptime/i;

/** Obvious bots and link-preview fetchers (counts are approximate by design). */
export function isLikelyBot(userAgent: string | null): boolean {
  return !userAgent?.trim() || BOT_UA.test(userAgent);
}

export async function getDoor(ctx: CoreCtx, id: string): Promise<DoorRow | null> {
  if (!UUID_RE.test(id)) return null;
  const [d] = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(crmDoors)
      .where(and(eq(crmDoors.id, id), eq(crmDoors.orgId, ctx.tenantId)))
      .limit(1),
  );
  return d ? toRow(d) : null;
}

/** Creates an OFF door with the kind's `defaultConfig`. */
export async function createDoor(
  ctx: CoreCtx,
  input: { kind: DoorKind; slug: string; title: string; createdBy?: string | null },
): Promise<DoorRow> {
  const mod = getDoorKind(input.kind);
  if (!mod) throw new DoorError('unknown_kind', 400);
  try {
    const [d] = await withOrgCore(ctx, (tx) =>
      tx
        .insert(crmDoors)
        .values({
          orgId: ctx.tenantId,
          kind: input.kind,
          slug: input.slug,
          title: input.title,
          active: false,
          config: mod.defaultConfig ?? {},
          createdBy: input.createdBy && UUID_RE.test(input.createdBy) ? input.createdBy : null,
        })
        .returning(),
    );
    return toRow(d);
  } catch (e) {
    if (uniqueViolation(e)) throw new DoorError('slug_taken', 409);
    throw e;
  }
}

export interface DoorPatch {
  title?: string;
  description?: string | null;
  slug?: string;
  active?: boolean;
  config?: unknown;
}

/** Partial update. `config` is validated by the kind's `configSchema` (400 with zod issues). */
export async function updateDoor(
  ctx: CoreCtx,
  id: string,
  patch: DoorPatch,
): Promise<DoorRow | null> {
  const current = await getDoor(ctx, id);
  if (!current) return null;
  const set: Partial<typeof crmDoors.$inferInsert> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.slug !== undefined) set.slug = patch.slug;
  if (patch.active !== undefined) set.active = patch.active;
  if (patch.config !== undefined) {
    const mod = getDoorKind(current.kind);
    if (!mod) throw new DoorError('unknown_kind', 400);
    const parsed = mod.configSchema.safeParse(patch.config);
    if (!parsed.success) throw new DoorError('invalid_config', 400, parsed.error.issues);
    set.config = parsed.data;
  }
  try {
    const [d] = await withOrgCore(ctx, (tx) =>
      tx
        .update(crmDoors)
        .set(set)
        .where(and(eq(crmDoors.id, id), eq(crmDoors.orgId, ctx.tenantId)))
        .returning(),
    );
    return d ? toRow(d) : null;
  } catch (e) {
    if (uniqueViolation(e)) throw new DoorError('slug_taken', 409);
    throw e;
  }
}

export const DOOR_RANGE_DAYS = [7, 30, 90] as const;

/**
 * Funnel range from `?from&to` (inclusive days) or `?days=7|30|90` (default 30,
 * ending today in the org's timezone `tz`).
 */
export function resolveDoorRange(
  params: URLSearchParams,
  tz: string,
  now: Date = new Date(),
): { from: string; to: string; days: number | null } {
  const from = params.get('from');
  const to = params.get('to');
  if (from && to && DAY_RE.test(from) && DAY_RE.test(to)) return { from, to, days: null };
  const asked = Number(params.get('days'));
  const days = (DOOR_RANGE_DAYS as readonly number[]).includes(asked) ? asked : 30;
  const today = orgLocalDateString(tz, now);
  const start = new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86_400_000);
  return { from: start.toISOString().slice(0, 10), to: today, days };
}

type Counts = {
  views: number;
  submissions: number;
  clicks: number;
  contacts: number;
  customers: number;
};

/**
 * Doors + booking links with their funnel for `[from, to]` (inclusive
 * `YYYY-MM-DD` days in the org's timezone `tz`; contacts use the instants bracketing them).
 * One grouped query per metric family, never one per door.
 */
export async function listDoorsWithFunnel(
  ctx: CoreCtx,
  range: { from: string; to: string },
  tz: string,
): Promise<DoorListRow[]> {
  if (!DAY_RE.test(range.from) || !DAY_RE.test(range.to)) throw new DoorError('invalid_range', 400);
  let window: { from: Date | null; to: Date | null };
  try {
    window = zonedDayWindow(range.from, range.to, tz);
  } catch {
    throw new DoorError('invalid_range', 400); // e.g. 2026-02-31
  }
  const since = (window.from as Date).toISOString();
  const until = (window.to as Date).toISOString();
  const withLinks = await isModuleEnabled(ctx, 'scheduling');
  const { doors, links, stats, people } = await withOrgCore(ctx, async (tx) => {
    const doors = await tx
      .select()
      .from(crmDoors)
      .where(eq(crmDoors.orgId, ctx.tenantId))
      .orderBy(asc(crmDoors.createdAt));
    const links = withLinks
      ? await tx
          .select({
            id: schedLinks.id,
            slug: schedLinks.slug,
            title: schedLinks.title,
            description: schedLinks.description,
            eventTypeIds: schedLinks.eventTypeIds,
            resourceId: schedLinks.resourceId,
            active: schedLinks.active,
            expiresAt: schedLinks.expiresAt,
          })
          .from(schedLinks)
          .where(eq(schedLinks.orgId, ctx.tenantId))
          .orderBy(asc(schedLinks.title))
      : [];
    const stats = (await tx.execute(sql`
      select door_key, sum(views)::int as views, sum(submissions)::int as submissions, sum(clicks)::int as clicks
      from crm_door_stats_daily
      where org_id = ${ctx.tenantId} and day >= ${range.from}::date and day <= ${range.to}::date
      group by door_key
    `)) as unknown as Array<{
      door_key: string;
      views: number;
      submissions: number;
      clicks: number;
    }>;
    const people = (await tx.execute(sql`
      select c.first_touch->>'door' as door_key,
             count(*)::int as contacts,
             count(*) filter (where
               exists (select 1 from pos_tickets t
                       where t.org_id = c.org_id and t.crm_contact_id = c.id and t.status = 'submitted')
               or exists (select 1 from sched_bookings b
                       where b.org_id = c.org_id and b.crm_contact_id = c.id and b.status = 'completed')
             )::int as customers
      from crm_contacts c
      where c.org_id = ${ctx.tenantId} and c.deleted_at is null and c.first_touch is not null
        and c.created_at >= ${since}::timestamptz and c.created_at < ${until}::timestamptz
      group by 1
    `)) as unknown as Array<{ door_key: string; contacts: number; customers: number }>;
    return { doors, links, stats, people };
  });

  const counts = new Map<string, Counts>();
  const at = (key: string) => {
    let c = counts.get(key);
    if (!c)
      counts.set(key, (c = { views: 0, submissions: 0, clicks: 0, contacts: 0, customers: 0 }));
    return c;
  };
  for (const s of stats)
    Object.assign(at(s.door_key), {
      views: Number(s.views),
      submissions: Number(s.submissions),
      clicks: Number(s.clicks),
    });
  for (const p of people)
    Object.assign(at(p.door_key), { contacts: Number(p.contacts), customers: Number(p.customers) });
  const zero: Counts = { views: 0, submissions: 0, clicks: 0, contacts: 0, customers: 0 };

  return [
    ...links.map((l): DoorListRow => {
      const key = `book:${l.id}`;
      return {
        key,
        id: l.id,
        kind: 'book',
        slug: l.slug,
        title: l.title,
        active: l.active,
        ...(counts.get(key) ?? zero),
        link: {
          description: l.description,
          eventTypeIds: l.eventTypeIds,
          resourceId: l.resourceId,
          expiresAt: l.expiresAt ? l.expiresAt.toISOString() : null,
        },
      };
    }),
    ...doors.map((d): DoorListRow => {
      const key = `door:${d.id}`;
      return {
        key,
        id: d.id,
        kind: d.kind as DoorKind,
        slug: d.slug,
        title: d.title,
        active: d.active,
        ...(counts.get(key) ?? zero),
      };
    }),
  ];
}

/**
 * "Where did this contact come from" for the contact page, from `first_touch`
 * (stored by doors and booking links). Null when the contact has none.
 */
export async function describeFirstTouch(
  ctx: CoreCtx,
  firstTouch: unknown,
): Promise<{ source: string | null; where: string | null; at: string | null } | null> {
  const t = firstTouch as Partial<{
    door: string;
    utm_source: string;
    referrer_host: string;
    at: string;
  }> | null;
  if (!t || typeof t !== 'object') return null;
  const m = /^(book|door):([0-9a-f-]{36})$/i.exec(t.door ?? '');
  let where: string | null = null;
  if (m) {
    const id = m[2];
    where = await withOrgCore(ctx, async (tx) => {
      const [r] =
        m[1] === 'door'
          ? await tx
              .select({ title: crmDoors.title })
              .from(crmDoors)
              .where(and(eq(crmDoors.id, id), eq(crmDoors.orgId, ctx.tenantId)))
              .limit(1)
          : await tx
              .select({ title: schedLinks.title })
              .from(schedLinks)
              .where(and(eq(schedLinks.id, id), eq(schedLinks.orgId, ctx.tenantId)))
              .limit(1);
      return r?.title ?? null;
    });
  }
  return { source: t.utm_source ?? t.referrer_host ?? null, where, at: t.at ?? null };
}
