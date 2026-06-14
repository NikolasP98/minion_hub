import { and, eq, desc, sql } from 'drizzle-orm';
import { cached, invalidateTags, keys, tags } from '@minion-stack/cache';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import {
  crmContacts,
  crmContactIdentities,
  crmActivities,
  crmTags,
  crmContactTags,
} from '$server/db/pg-crm-schema';
import { RFM_WEIGHTS, RFM_CONST, tryCompileTagRule } from './crm-scoring';

/**
 * CRM service (spec §4–8). Contacts = inbound senders to the org's registered
 * channels; the journey + score are DERIVED from the `messages` ledger, never
 * copied. Every method routes through `withOrgCore` (role app_ledger + GUC), so
 * RLS is the hard backstop — NEVER use getCoreDb() directly here.
 */

// ── Eligibility predicate (spec §8): which ledger rows yield contacts ─────────
// inbound, non-bot, non-group, sender present. Shared by sync + (potential) counts.
const ELIGIBLE = sql`m.direction = 'inbound'
  and m.sender_id is not null
  and coalesce(m.is_bot, false) = false
  and coalesce(m.is_group, false) = false`;

export interface SyncResult {
  created: number;
}

/**
 * Idempotent set-based harvest: ensure a contact + identity exists for every
 * NEW inbound `(channel, sender_id)` the ledger knows but CRM doesn't. No
 * counters (rollups are the crm_contact_stats view), no watermark (the anti-join
 * IS the reconciliation), no locks (ON CONFLICT makes concurrent runs no-ops).
 */
export async function syncContactsFromLedger(ctx: CoreCtx): Promise<SyncResult> {
  const result = await withOrgCore(ctx, async (tx) => {
    // 1. Anti-join: senders in the ledger with no crm identity yet. Newest
    //    name/handle wins (distinct on … order by created_at desc).
    const eligible = (await tx.execute(sql`
      select distinct on (m.channel, m.sender_id)
             m.channel as channel, m.sender_id as sender_id,
             m.sender_name as sender_name, m.sender_handle as sender_handle
      from messages m
      left join crm_contact_identities ci
        on ci.org_id = ${ctx.tenantId}
       and ci.channel = m.channel
       and ci.external_id = m.sender_id
      where m.org_id = ${ctx.tenantId}
        and ${ELIGIBLE}
        and ci.id is null
      order by m.channel, m.sender_id, m.created_at desc
    `)) as unknown as Array<{
      channel: string;
      sender_id: string;
      sender_name: string | null;
      sender_handle: string | null;
    }>;

    let created = 0;
    // 2. Per-row create: contact shell + identity in one statement (contact
    //    exists before its identity FK is checked). ON CONFLICT DO NOTHING makes
    //    a concurrent run that already created the identity a harmless no-op.
    for (const e of eligible) {
      const res = await tx.execute(sql`
        with c as (
          insert into crm_contacts (org_id, display_name, source)
          values (${ctx.tenantId}, ${e.sender_name}, 'harvested')
          returning id
        )
        insert into crm_contact_identities (org_id, contact_id, channel, external_id, handle)
        select ${ctx.tenantId}, c.id, ${e.channel}, ${e.sender_id}, ${e.sender_handle} from c
        on conflict (org_id, channel, external_id) do nothing
        returning contact_id
      `);
      if ((res as unknown as unknown[]).length > 0) created++;
    }

    // 3. Sweep orphan shells (the rare concurrent-loser: contact inserted but its
    //    identity lost the ON CONFLICT race). Only ever touches harvested shells.
    await tx.execute(sql`
      delete from crm_contacts c
      where c.org_id = ${ctx.tenantId}
        and c.source = 'harvested'
        and not exists (select 1 from crm_contact_identities i where i.contact_id = c.id)
    `);

    return { created };
  });
  if (result.created > 0) await bustCrmList(ctx.tenantId);
  return result;
}

// ── Ranking (spec §6): on-read RFM over the ledger ───────────────────────────

export interface RankFilters {
  stage?: string;
  channel?: string;
  minScore?: number;
  maxScore?: number;
  tagId?: string;
  /** Restrict to a single contact (used by the detail page to get its score). */
  contactId?: string;
  /** auto-tag rule jsonb (compiled to a live SQL predicate) */
  ruleJson?: unknown;
  search?: string;
  sort?: 'score' | 'recent' | 'frequency' | 'name';
  limit?: number;
  offset?: number;
}

export interface RankedContact {
  contact_id: string;
  display_name: string | null;
  owner_id: string | null;
  source: string;
  total_msgs: number;
  inbound_msgs: number;
  channels_used: number;
  /** Distinct channels the contact has an identity on (for branded icons). */
  channels: string[];
  /** Applied manual-tag ids (for client-side tag filtering). */
  tag_ids: string[];
  first_contact_at: string | null;
  last_contact_at: string | null;
  last_days: number;
  reciprocity: number;
  r_score: number;
  f_score: number;
  m_score: number;
  score: number;
  stage: string;
}

// RFM expressions, parameterised by the shared weights/constants so SQL and the
// UI explainability tooltip stay in lockstep. The constants MUST be inlined as
// SQL literals via `lit()` (sql.raw), NOT interpolated as `${HL}` — Drizzle turns
// a JS number into a bound parameter ($1), so `${HL}.0` would emit the malformed
// `$1.0` ("syntax error at or near .0"). lit() is safe here: these are trusted
// internal numeric constants, never user input.
const { recencyHalfLifeDays: HL, freqSaturationMsgs: FS, volSaturationMsgs: VS, channelTarget: CT } =
  RFM_CONST;
const lit = (n: number) => sql.raw(String(n));
const R_EXPR = sql`(100 * exp(- last_days / ${lit(HL)}.0))`;
const F_EXPR = sql`(100 * least(1, ln(1 + inbound_msgs) / ln(1 + ${lit(FS)}.0)))`;
const M_EXPR = sql`(100 * (0.60 * least(1, ln(1 + total_msgs) / ln(1 + ${lit(VS)}.0))
                        + 0.25 * least(1, channels_used / ${lit(CT)}.0)
                        + 0.15 * reciprocity))`;

/**
 * Ranked contact list. Builds: agg (ledger rollups) → base (contact + derived
 * stats + stage) → scored (RFM columns) → filtered/sorted outer select. The
 * stage CASE here is the authoritative list stage; it MUST mirror
 * deriveLifecycleStage() in crm-scoring.ts.
 */
export async function rankContacts(ctx: CoreCtx, f: RankFilters = {}): Promise<RankedContact[]> {
  return withOrgCore(ctx, async (tx) => {
    const ruleSql = f.ruleJson != null ? tryCompileTagRule(f.ruleJson) : null;

    const conds = [sql`c.deleted_at is null`];
    if (f.contactId) conds.push(sql`c.id = ${f.contactId}`);
    if (f.search) conds.push(sql`c.display_name ilike ${'%' + f.search + '%'}`);
    if (f.tagId)
      conds.push(
        sql`exists (select 1 from crm_contact_tags ct where ct.contact_id = c.id and ct.tag_id = ${f.tagId})`,
      );

    const outer = [sql`true`];
    if (f.stage) outer.push(sql`stage = ${f.stage}`);
    if (f.channel)
      outer.push(
        sql`exists (select 1 from crm_contact_identities ci2 where ci2.contact_id = contact_id and ci2.channel = ${f.channel})`,
      );
    if (typeof f.minScore === 'number') outer.push(sql`score >= ${f.minScore}`);
    if (typeof f.maxScore === 'number') outer.push(sql`score <= ${f.maxScore}`);
    if (ruleSql) outer.push(sql.raw(ruleSql)); // vetted: whitelisted columns only

    const orderBy =
      f.sort === 'recent'
        ? sql`last_contact_at desc nulls last, display_name asc nulls last`
        : f.sort === 'frequency'
          ? sql`total_msgs desc, display_name asc nulls last`
          : f.sort === 'name'
            ? sql`display_name asc nulls last`
            : sql`score desc, display_name asc nulls last`;

    const limit = Math.min(f.limit ?? 100, 5000);
    const offset = f.offset ?? 0;

    const rows = await tx.execute(sql`
      with agg as (
        select ci.contact_id,
               max(coalesce(m.occurred_at, m.created_at)) as last_contact_at,
               min(coalesce(m.occurred_at, m.created_at)) as first_contact_at,
               count(*) as total_msgs,
               count(*) filter (where m.direction = 'inbound') as inbound_msgs,
               count(distinct m.channel) as channels_used
        from crm_contact_identities ci
        join messages m
          on m.org_id = ci.org_id and m.channel = ci.channel and m.sender_id = ci.external_id
        where m.is_bot is not true
        group by ci.contact_id
      ),
      base as (
        select c.id as contact_id, c.display_name, c.owner_id, c.source, c.lifecycle_override,
               coalesce(a.total_msgs, 0) as total_msgs,
               coalesce(a.inbound_msgs, 0) as inbound_msgs,
               coalesce(a.channels_used, 0) as channels_used,
               (select coalesce(array_agg(distinct ci.channel order by ci.channel), array[]::text[])
                  from crm_contact_identities ci where ci.contact_id = c.id) as channels,
               (select coalesce(array_agg(ct.tag_id::text), array[]::text[])
                  from crm_contact_tags ct where ct.contact_id = c.id) as tag_ids,
               a.first_contact_at, a.last_contact_at,
               coalesce(extract(epoch from (now() - a.last_contact_at)) / 86400.0, 1e9) as last_days,
               coalesce(extract(epoch from (now() - a.first_contact_at)) / 86400.0, 1e9) as first_days,
               coalesce(a.inbound_msgs::numeric / nullif(a.total_msgs, 0), 0) as reciprocity
        from crm_contacts c
        left join agg a on a.contact_id = c.id
        where ${and(...conds)}
      ),
      scored as (
        select contact_id, display_name, owner_id, source, channels, tag_ids,
               total_msgs, inbound_msgs, channels_used, first_contact_at, last_contact_at,
               round(last_days::numeric, 1) as last_days, round(reciprocity::numeric, 3) as reciprocity,
               round(${R_EXPR}::numeric, 1) as r_score,
               round(${F_EXPR}::numeric, 1) as f_score,
               round(${M_EXPR}::numeric, 1) as m_score,
               round((${lit(RFM_WEIGHTS.r)} * ${R_EXPR} + ${lit(RFM_WEIGHTS.f)} * ${F_EXPR} + ${lit(RFM_WEIGHTS.m)} * ${M_EXPR})::numeric, 0) as score,
               coalesce(lifecycle_override,
                 case
                   when total_msgs = 0 then 'New'
                   when last_days > 90 then 'Churned'
                   when last_days > 30 then 'Dormant'
                   when last_days <= 30 and total_msgs >= 10 then 'Active'
                   when last_days <= 14 and inbound_msgs >= 1 and (total_msgs - inbound_msgs) >= 1 then 'Engaged'
                   when first_days < 7 and total_msgs < 3 then 'New'
                   when last_days <= 30 then 'Engaged'
                   else 'Dormant'
                 end) as stage
        from base
      )
      select * from scored
      where ${and(...outer)}
      order by ${orderBy}
      limit ${limit} offset ${offset}
    `);
    return rows as unknown as RankedContact[];
  });
}

/** Cache tag for an org's CRM contact list — bust on any contact/tag mutation. */
function crmListTags(tenantId: string) {
  return tags.tenantDomain(tenantId, 'crm');
}
/** Invalidate the cached ranked list (call after any mutation that changes it). */
function bustCrmList(tenantId: string) {
  return invalidateTags([...crmListTags(tenantId)]);
}

/**
 * The full ranked roster for the list page, Valkey-cached. The page does all
 * search/stage/tag/sort filtering CLIENT-SIDE over this list (instant, no Apply,
 * no per-keystroke server round-trip), so we cache one unfiltered payload per org.
 * RFM recency is day-scaled, so a 2m TTL is imperceptible; mutations bust the tag.
 */
export function listContactsCached(ctx: CoreCtx): Promise<RankedContact[]> {
  return cached(
    keys.hub('crm-contacts', { t: ctx.tenantId }),
    { ttl: '2m', swr: '30s', tags: [...crmListTags(ctx.tenantId)] },
    () => rankContacts(ctx, { limit: 5000 }),
  );
}

// ── Single contact + journey ──────────────────────────────────────────────────

export async function getContact(ctx: CoreCtx, id: string) {
  return withOrgCore(ctx, async (tx) => {
    const [contact] = await tx
      .select()
      .from(crmContacts)
      .where(and(eq(crmContacts.id, id), eq(crmContacts.orgId, ctx.tenantId)))
      .limit(1);
    if (!contact) return null;
    const identities = await tx
      .select()
      .from(crmContactIdentities)
      .where(eq(crmContactIdentities.contactId, id));
    const [stats] = (await tx.execute(sql`
      select message_count, inbound_count, channels_used, first_contact_at, last_contact_at
      from crm_contact_stats where contact_id = ${id}
    `)) as unknown as Array<Record<string, unknown>>;
    return { contact, identities, stats: stats ?? null };
  });
}

export async function getContactTimeline(ctx: CoreCtx, id: string, limit = 100) {
  return withOrgCore(ctx, async (tx) => {
    const rows = await tx.execute(sql`
      select kind, direction, channel, body, agent_id, data, occurred_at, source_id
      from crm_contact_timeline
      where contact_id = ${id}
      order by occurred_at desc
      limit ${Math.min(limit, 500)}
    `);
    return rows as unknown as Array<Record<string, unknown>>;
  });
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function createContact(
  ctx: CoreCtx,
  data: { displayName?: string | null; customFields?: Record<string, unknown> },
) {
  const row = await withOrgCore(ctx, async (tx) => {
    const [r] = await tx
      .insert(crmContacts)
      .values({
        orgId: ctx.tenantId,
        displayName: data.displayName ?? null,
        source: 'manual',
        customFields: data.customFields ?? {},
      })
      .returning();
    return r;
  });
  await bustCrmList(ctx.tenantId);
  return row;
}

export async function updateContact(
  ctx: CoreCtx,
  id: string,
  data: {
    displayName?: string | null;
    ownerId?: string | null;
    lifecycleOverride?: string | null;
    customFields?: Record<string, unknown>;
  },
) {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (data.displayName !== undefined) set.displayName = data.displayName;
  if (data.ownerId !== undefined) set.ownerId = data.ownerId;
  if (data.lifecycleOverride !== undefined) set.lifecycleOverride = data.lifecycleOverride;
  if (data.customFields !== undefined) set.customFields = data.customFields;
  const row = await withOrgCore(ctx, async (tx) => {
    const [r] = await tx
      .update(crmContacts)
      .set(set)
      .where(and(eq(crmContacts.id, id), eq(crmContacts.orgId, ctx.tenantId)))
      .returning();
    return r ?? null;
  });
  await bustCrmList(ctx.tenantId);
  return row;
}

/** Soft-delete (right-to-erasure first step). */
export async function softDeleteContact(ctx: CoreCtx, id: string) {
  await withOrgCore(ctx, (tx) =>
    tx
      .update(crmContacts)
      .set({ deletedAt: new Date() })
      .where(and(eq(crmContacts.id, id), eq(crmContacts.orgId, ctx.tenantId))),
  );
  await bustCrmList(ctx.tenantId);
}

/** Hard-delete ("Forget this contact" — removes contact + identities + activities
 *  via FK cascade). The underlying ledger rows are a separate retention domain. */
export async function hardDeleteContact(ctx: CoreCtx, id: string) {
  await withOrgCore(ctx, (tx) =>
    tx.delete(crmContacts).where(and(eq(crmContacts.id, id), eq(crmContacts.orgId, ctx.tenantId))),
  );
  await bustCrmList(ctx.tenantId);
}

export async function addNote(ctx: CoreCtx, contactId: string, body: string, actorId: string | null) {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .insert(crmActivities)
      .values({ orgId: ctx.tenantId, contactId, kind: 'note', body, actorId })
      .returning();
    return row;
  });
}

// ── Tags ──────────────────────────────────────────────────────────────────────

export async function listTags(ctx: CoreCtx) {
  return withOrgCore(ctx, (tx) =>
    tx.select().from(crmTags).where(eq(crmTags.orgId, ctx.tenantId)).orderBy(desc(crmTags.position)),
  );
}

export async function createTag(
  ctx: CoreCtx,
  data: { name: string; color?: string | null; kind?: 'manual' | 'auto'; rule?: unknown },
  createdBy: string | null,
) {
  // Reject an auto-tag whose rule won't compile (fail fast, not silently).
  if (data.kind === 'auto' && tryCompileTagRule(data.rule) == null) {
    throw new Error('Invalid auto-tag rule');
  }
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .insert(crmTags)
      .values({
        orgId: ctx.tenantId,
        name: data.name,
        color: data.color ?? null,
        kind: data.kind ?? 'manual',
        rule: (data.rule as object) ?? null,
      })
      .returning();
    return row;
  });
}

export async function deleteTag(ctx: CoreCtx, tagId: string) {
  return withOrgCore(ctx, (tx) =>
    tx.delete(crmTags).where(and(eq(crmTags.id, tagId), eq(crmTags.orgId, ctx.tenantId))),
  );
}

export async function applyTag(ctx: CoreCtx, contactId: string, tagId: string, appliedBy: string | null) {
  await withOrgCore(ctx, (tx) =>
    tx
      .insert(crmContactTags)
      .values({ orgId: ctx.tenantId, contactId, tagId, appliedBy })
      .onConflictDoNothing(),
  );
  await bustCrmList(ctx.tenantId);
}

export async function removeTag(ctx: CoreCtx, contactId: string, tagId: string) {
  await withOrgCore(ctx, (tx) =>
    tx
      .delete(crmContactTags)
      .where(and(eq(crmContactTags.contactId, contactId), eq(crmContactTags.tagId, tagId))),
  );
  await bustCrmList(ctx.tenantId);
}

/** Manual tags currently applied to a contact (for the detail panel). */
export async function getContactTags(ctx: CoreCtx, contactId: string) {
  return withOrgCore(ctx, (tx) =>
    tx
      .select({ id: crmTags.id, name: crmTags.name, color: crmTags.color, kind: crmTags.kind })
      .from(crmContactTags)
      .innerJoin(crmTags, eq(crmTags.id, crmContactTags.tagId))
      .where(eq(crmContactTags.contactId, contactId)),
  );
}
