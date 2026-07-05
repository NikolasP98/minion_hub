import { and, eq, desc, sql } from 'drizzle-orm';
import { cached, invalidateTags, keys, tags } from '@minion-stack/cache';
import { withOrgCore } from '$server/db/with-org-core';
import { maskPii, maskContactFields } from '$lib/pii';
import type { CoreCtx } from '$server/auth/core-ctx';
import {
  crmContacts,
  crmContactIdentities,
  crmActivities,
  crmTags,
  crmContactTags,
  crmSettings,
} from '$server/db/pg-crm-schema';
import { RFM_WEIGHTS, RFM_CONST, tryCompileTagRule } from './crm-scoring';
import { reconcileParties } from './party.service';
import { CONTACT_PARTY } from './crm-finance.service';
import { bothEnabled } from './modules.service';
import { autoAssign } from './assignment.service';
import { recordAudit } from './activity.service';
import { isFunnelStage, readFunnelMeta, funnelStageIndex } from '$lib/components/crm/crm-funnel';
import { StaleWriteError, staleGuard } from './errors';

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
  // Harvest gate: only accounts the user has added to the CRM scope (and not
  // paused) create new contacts. `all` = legacy/unconfigured → harvest every
  // account; an explicit but empty scope harvests nothing.
  const scope = await getHarvestScope(ctx);
  const accountGate = scope.all
    ? sql``
    : scope.accounts.length === 0
      ? sql`and false`
      : sql`and (m.channel, coalesce(m.account_id, '')) in (${sql.join(
          scope.accounts.map((a) => sql`(${a.channel}, ${a.accountId})`),
          sql`, `,
        )})`;
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
        ${accountGate}
        and ci.id is null
      order by m.channel, m.sender_id, m.created_at desc
    `)) as unknown as Array<{
      channel: string;
      sender_id: string;
      sender_name: string | null;
      sender_handle: string | null;
    }>;

    let created = 0;
    // 2. Set-based create: one contact shell + one identity per eligible row in a
    //    single statement. A contact-id is minted per source row (gen_random_uuid,
    //    same default the table uses) so the shell insert and the identity insert
    //    share a stable join key — no reliance on RETURNING order. Both inserts
    //    run in one CTE so the contact exists before its identity FK is checked.
    //    ON CONFLICT DO NOTHING keeps a concurrent run that already created the
    //    identity a harmless no-op (its orphan shell is swept in step 3).
    if (eligible.length > 0) {
      const rows = sql.join(
        eligible.map(
          (e) => sql`(${e.channel}, ${e.sender_id}, ${e.sender_name}, ${e.sender_handle})`,
        ),
        sql`, `,
      );
      const res = await tx.execute(sql`
        with src as (
          select gen_random_uuid() as cid, channel, sender_id, sender_name, sender_handle
          from (values ${rows})
            as v(channel, sender_id, sender_name, sender_handle)
        ),
        shells as (
          insert into crm_contacts (id, org_id, display_name, source)
          select cid, ${ctx.tenantId}, sender_name, 'harvested' from src
        )
        insert into crm_contact_identities (org_id, contact_id, channel, external_id, handle)
        select ${ctx.tenantId}, cid, channel, sender_id, sender_handle from src
        on conflict (org_id, channel, external_id) do nothing
        returning contact_id
      `);
      created = (res as unknown as unknown[]).length;
    }

    // 3. Sweep orphan shells (the rare concurrent-loser: contact inserted but its
    //    identity lost the ON CONFLICT race). Only ever touches harvested shells.
    await tx.execute(sql`
      delete from crm_contacts c
      where c.org_id = ${ctx.tenantId}
        and c.source = 'harvested'
        and not exists (select 1 from crm_contact_identities i where i.contact_id = c.id)
    `);

    // 4. Name-fill: harvested contacts created before their sender had a
    //    ledger name (e.g. a source that only started sending names later)
    //    pick up the newest one. Fill-if-null on 'harvested' shells only —
    //    never overwrites a user-edited or existing name.
    await tx.execute(sql`
      update crm_contacts c
      set display_name = ln.sender_name
      from crm_contact_identities ci,
           lateral (
             select m.sender_name
             from messages m
             where m.org_id = ${ctx.tenantId}
               and m.channel = ci.channel
               and m.sender_id = ci.external_id
               and m.sender_name is not null
               and ${ELIGIBLE}
             order by m.created_at desc
             limit 1
           ) ln
      where ci.org_id = ${ctx.tenantId}
        and ci.contact_id = c.id
        and c.org_id = ${ctx.tenantId}
        and c.source = 'harvested'
        and c.display_name is null
    `);

    return { created };
  });
  if (result.created > 0) {
    await bustCrmList(ctx.tenantId);
    // One summary row per run, not per contact — the harvest is a bulk anti-join,
    // not a user-initiated write; per-row audit would flood doc_audit_log.
    await recordAudit(ctx, {
      refType: 'crm_harvest',
      refId: ctx.tenantId,
      op: 'create',
      changes: [{ field: 'created', label: 'Contacts created', old: null, new: result.created }],
      actor: { id: null, name: 'system:harvest' },
    });
  }
  // Keep the party spine in step with harvested contacts (idempotent, set-based).
  await reconcileParties(ctx);
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
  /** Record-level (if-owner) scope: restrict to contacts owned by this profile. */
  ownerId?: string;
  /** Field-level: redact PII in custom_fields (phone/email/dni) for low field level. */
  maskSensitive?: boolean;
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
  /** Custom-field metadata (jsonb) — drives the user-configurable list columns. */
  custom_fields: Record<string, unknown>;
  /** Effective first interaction = earliest of {first message, first purchase}. */
  first_contact_at: string | null;
  /** Effective last interaction = latest of {last message, last purchase}. */
  last_contact_at: string | null;
  /** Has any finance invoice (a prior paying/booking relationship). */
  is_buyer: boolean;
  /** true when the latest message is inbound with no later reply — we owe them. */
  awaiting_reply: boolean;
  last_days: number;
  reciprocity: number;
  r_score: number;
  f_score: number;
  m_score: number;
  score: number;
  stage: string;
  /** Auto-tag ids whose rule matches this row (computed in the page load, not SQL). */
  auto_tag_ids?: string[];
}

// RFM expressions, parameterised by the shared weights/constants so SQL and the
// UI explainability tooltip stay in lockstep. The constants MUST be inlined as
// SQL literals via `lit()` (sql.raw), NOT interpolated as `${HL}` — Drizzle turns
// a JS number into a bound parameter ($1), so `${HL}.0` would emit the malformed
// `$1.0` ("syntax error at or near .0"). lit() is safe here: these are trusted
// internal numeric constants, never user input.
const {
  recencyHalfLifeDays: HL,
  freqSaturationMsgs: FS,
  volSaturationMsgs: VS,
  channelTarget: CT,
} = RFM_CONST;
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
 * deriveLifecycleStage() in crm-scoring.ts. Lifecycle recency uses the EFFECTIVE
 * anchors (messages bridged with finance purchases), so a long-time buyer who
 * only messaged recently is not mislabelled "New".
 */
export async function rankContacts(ctx: CoreCtx, f: RankFilters = {}): Promise<RankedContact[]> {
  return withOrgCore(ctx, async (tx) => {
    const ruleSql = f.ruleJson != null ? tryCompileTagRule(f.ruleJson) : null;

    const conds = [sql`c.deleted_at is null`];
    // Record-level (if-owner) scoping: only the caller's own contacts.
    if (f.ownerId) conds.push(sql`c.owner_id = ${f.ownerId}`);
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

    // When scoring a single contact (detail page), push its id into the agg CTE
    // so we aggregate only that contact's conversation — not the whole roster.
    const aggWhere = f.contactId
      ? sql`where m.is_bot is not true and ci.contact_id = ${f.contactId}`
      : sql`where m.is_bot is not true`;

    // Finance bridge: a contact's purchase history (via the PARTY SPINE — same
    // CONTACT_PARTY map as crm-finance.service) gives a TRUE first/last
    // interaction that predates the message ledger — a 2024 buyer who messaged
    // last week is not "New", and a finance-only payer is a buyer, not "New".
    // Only joined when both CRM + Finances are on; otherwise an empty CTE so the
    // lifecycle degrades cleanly to message-only signals.
    const withFinance = await bothEnabled(ctx, 'crm', 'finances');
    const finCte = withFinance
      ? sql`fin as (
          select cp.contact_id,
                 min(fi.issued_at) as first_purchase_at,
                 max(fi.issued_at) as last_purchase_at
          from contact_party cp
          join fin_clients fc on fc.org_id = ${ctx.tenantId} and fc.party_id = cp.party_id
          join fin_invoices fi on fi.client_id = fc.id
          group by cp.contact_id
        )`
      : sql`fin as (select null::uuid as contact_id, null::timestamptz as first_purchase_at, null::timestamptz as last_purchase_at where false)`;

    const rows = await tx.execute(sql`
      with agg as (
        select ci.contact_id,
               max(coalesce(m.occurred_at, m.created_at)) as last_contact_at,
               min(coalesce(m.occurred_at, m.created_at)) as first_contact_at,
               max(coalesce(m.occurred_at, m.created_at)) filter (where m.direction = 'inbound') as last_inbound_at,
               max(coalesce(m.occurred_at, m.created_at)) filter (where m.direction = 'outbound') as last_outbound_at,
               count(*) as total_msgs,
               count(*) filter (where m.direction = 'inbound') as inbound_msgs,
               count(distinct m.channel) as channels_used
        from crm_contact_identities ci
        join messages m
          -- match the whole conversation (chat_id), not just msgs the contact sent
          on m.org_id = ci.org_id and m.channel = ci.channel and m.chat_id = ci.external_id
        ${aggWhere}
        group by ci.contact_id
      ),
      ${withFinance ? sql`${CONTACT_PARTY},` : sql``}
      ${finCte},
      base as (
        select c.id as contact_id, c.display_name, c.owner_id, c.source, c.lifecycle_override,
               c.custom_fields as custom_fields,
               coalesce(a.total_msgs, 0) as total_msgs,
               coalesce(a.inbound_msgs, 0) as inbound_msgs,
               coalesce(a.channels_used, 0) as channels_used,
               (select coalesce(array_agg(distinct ci.channel order by ci.channel), array[]::text[])
                  from crm_contact_identities ci where ci.contact_id = c.id) as channels,
               (select coalesce(array_agg(ct.tag_id::text), array[]::text[])
                  from crm_contact_tags ct where ct.contact_id = c.id) as tag_ids,
               -- effective first/last interaction = earliest/latest of {message, purchase}
               least(a.first_contact_at, fn.first_purchase_at) as first_contact_at,
               greatest(a.last_contact_at, fn.last_purchase_at) as last_contact_at,
               (fn.first_purchase_at is not null) as is_buyer,
               (a.last_inbound_at is not null and (a.last_outbound_at is null or a.last_inbound_at > a.last_outbound_at)) as awaiting_reply,
               -- message-only recency drives the RFM score (engagement is a messaging axis)
               coalesce(extract(epoch from (now() - a.last_contact_at)) / 86400.0, 1e9) as last_days,
               -- effective recency (msgs + purchases) drives the lifecycle stage + New/Active KPIs
               coalesce(extract(epoch from (now() - greatest(a.last_contact_at, fn.last_purchase_at))) / 86400.0, 1e9) as eff_last_days,
               coalesce(extract(epoch from (now() - least(a.first_contact_at, fn.first_purchase_at))) / 86400.0, 1e9) as eff_first_days,
               coalesce(a.inbound_msgs::numeric / nullif(a.total_msgs, 0), 0) as reciprocity
        from crm_contacts c
        left join agg a on a.contact_id = c.id
        left join fin fn on fn.contact_id = c.id
        where ${and(...conds)}
      ),
      scored as (
        select contact_id, display_name, owner_id, source, channels, tag_ids,
               coalesce(custom_fields, '{}'::jsonb) as custom_fields,
               total_msgs, inbound_msgs, channels_used, first_contact_at, last_contact_at, awaiting_reply, is_buyer,
               round(last_days::numeric, 1) as last_days, round(reciprocity::numeric, 3) as reciprocity,
               round(${R_EXPR}::numeric, 1) as r_score,
               round(${F_EXPR}::numeric, 1) as f_score,
               round(${M_EXPR}::numeric, 1) as m_score,
               round((${lit(RFM_WEIGHTS.r)} * ${R_EXPR} + ${lit(RFM_WEIGHTS.f)} * ${F_EXPR} + ${lit(RFM_WEIGHTS.m)} * ${M_EXPR})::numeric, 0) as score,
               coalesce(lifecycle_override,
                 case
                   -- pure cold record: never messaged AND never bought → genuinely new
                   when total_msgs = 0 and not is_buyer then 'New'
                   when eff_last_days > 90 then 'Churned'
                   when eff_last_days > 30 then 'Dormant'
                   when eff_last_days <= 30 and total_msgs >= 10 then 'Active'
                   -- Engaged: recent inbound (two-way requirement dropped — the org
                   -- rarely replies in-channel, so requiring an outbound buried everyone in New)
                   when eff_last_days <= 14 and inbound_msgs >= 1 then 'Engaged'
                   -- genuinely new: first-ever interaction <7d, low activity, not a prior buyer
                   when eff_first_days < 7 and total_msgs < 3 and not is_buyer then 'New'
                   when eff_last_days <= 30 then 'Engaged'
                   else 'Dormant'
                 end) as stage
        from base
      )
      select * from scored
      where ${and(...outer)}
      order by ${orderBy}
      limit ${limit} offset ${offset}
    `);
    const out = rows as unknown as RankedContact[];
    // Field-level (Phase 4): redact PII in custom_fields (phone/email/dni) — the
    // Customers list renders these as Phone/ID columns.
    if (!f.maskSensitive) return out;
    return out.map((r) => ({ ...r, custom_fields: maskContactFields(r.custom_fields) }));
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
export function listContactsCached(
  ctx: CoreCtx,
  ownerId?: string,
  maskSensitive = false,
): Promise<RankedContact[]> {
  return cached(
    // Fold owner + mask into the tenant key so an if-owner-scoped or PII-masked
    // caller gets a distinct cached payload (never reads/poisons the org-wide
    // roster). The org-level invalidation tag still busts all on any mutation.
    keys.hub('crm-contacts', {
      t: `${ctx.tenantId}${ownerId ? `:${ownerId}` : ''}${maskSensitive ? ':m' : ''}`,
    }),
    { ttl: '2m', swr: '30s', tags: [...crmListTags(ctx.tenantId)] },
    () => rankContacts(ctx, { limit: 5000, ownerId, maskSensitive }),
  );
}

// ── Single contact + journey ──────────────────────────────────────────────────

export async function getContact(ctx: CoreCtx, id: string, ownerId?: string, maskSensitive = false) {
  return withOrgCore(ctx, async (tx) => {
    const [contact] = await tx
      .select()
      .from(crmContacts)
      // Record-level (if-owner) scoping: a scoped caller can only open contacts
      // they own. Treated as not-found (404) rather than 403 to avoid leaking
      // existence of other reps' contacts.
      .where(
        and(
          eq(crmContacts.id, id),
          eq(crmContacts.orgId, ctx.tenantId),
          ...(ownerId ? [eq(crmContacts.ownerId, ownerId)] : []),
        ),
      )
      .limit(1);
    if (!contact) return null;
    const identitiesRaw = await tx
      .select()
      .from(crmContactIdentities)
      .where(eq(crmContactIdentities.contactId, id));
    // Field-level (Phase 4): mask the PII below the crm field level — both the
    // channel identities (external_id = phone/email/handle) AND the custom_fields
    // (the detail page renders telefono/dni/email from there, same as the list).
    const identities = maskSensitive
      ? identitiesRaw.map((i) => ({ ...i, externalId: maskPii(i.externalId), masked: true }))
      : identitiesRaw;
    const maskedContact = maskSensitive
      ? { ...contact, customFields: maskContactFields(contact.customFields as Record<string, unknown>) }
      : contact;
    const [stats] = (await tx.execute(sql`
      select message_count, inbound_count, channels_used, first_contact_at, last_contact_at
      from crm_contact_stats where contact_id = ${id}
    `)) as unknown as Array<Record<string, unknown>>;
    return { contact: maskedContact, identities, stats: stats ?? null, piiMasked: maskSensitive };
  });
}

/**
 * fetch_from source for a contact — the fields a form auto-fills when you pick a
 * contact (ERPNext `fetch_from`). name from the contact, phone from its WhatsApp
 * identity, email from custom_fields. Cheap; safe to call on selection.
 */
export async function getContactPrefill(
  ctx: CoreCtx,
  id: string,
): Promise<{ name: string | null; phone: string | null; email: string | null } | null> {
  return withOrgCore(ctx, async (tx) => {
    const [c] = await tx
      .select({ name: crmContacts.displayName, customFields: crmContacts.customFields })
      .from(crmContacts)
      .where(and(eq(crmContacts.id, id), eq(crmContacts.orgId, ctx.tenantId)))
      .limit(1);
    if (!c) return null;
    const [wa] = await tx
      .select({ externalId: crmContactIdentities.externalId })
      .from(crmContactIdentities)
      .where(and(eq(crmContactIdentities.contactId, id), eq(crmContactIdentities.channel, 'whatsapp')))
      .limit(1);
    // WhatsApp external_id is the phone (often `51999...@s.whatsapp.net`) — keep digits.
    const phone = wa?.externalId ? wa.externalId.replace(/\D/g, '') || null : null;
    const cf = (c.customFields ?? {}) as Record<string, unknown>;
    const email = (cf.email ?? cf.correo ?? null) as string | null;
    return { name: c.name ?? null, phone, email };
  });
}

export async function getContactTimeline(ctx: CoreCtx, id: string, limit = 100) {
  return withOrgCore(ctx, async (tx) => {
    const rows = await tx.execute(sql`
      select kind, direction, channel, body, agent_id, data, occurred_at, source_id, client_id
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
    await recordAudit(ctx, {
      refType: 'crm_contact',
      refId: r.id,
      op: 'create',
      changes: [{ field: 'displayName', label: 'Name', old: null, new: r.displayName }],
      actor: { id: ctx.profileId ?? null, name: null },
    });
    return r;
  });
  // Auto-assign via assignment rules (no-op if no rule matches), mirroring
  // support.createIssue — leads were the other owner_id holder left unwired.
  if (!row.ownerId) {
    const assignee = await autoAssign(ctx, 'crm_contact', row);
    if (assignee) row.ownerId = assignee;
  }
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
    /** Standard "phone" field: mirrored to a `phone` channel identity so an
     *  edited number shows up in the Identities list. '' / null removes it.
     *  Does NOT touch the WhatsApp identity (its external_id is the message
     *  join key). */
    phone?: string | null;
  },
  expectedUpdatedAt?: Date,
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
      .where(
        and(
          eq(crmContacts.id, id),
          eq(crmContacts.orgId, ctx.tenantId),
          staleGuard(crmContacts.updatedAt, expectedUpdatedAt),
        ),
      )
      .returning();
    if (!r) {
      if (expectedUpdatedAt) {
        const [existing] = await tx
          .select()
          .from(crmContacts)
          .where(and(eq(crmContacts.id, id), eq(crmContacts.orgId, ctx.tenantId)))
          .limit(1);
        if (existing) throw new StaleWriteError(existing);
      }
      return null;
    }
    // No pre-image SELECT on this path (would be an extra round-trip per write) —
    // log the new values only, not a before/after diff.
    const auditChanges = Object.entries(set)
      .filter(([field]) => field !== 'updatedAt')
      .map(([field, value]) => ({ field, label: field, old: null, new: value }));
    if (auditChanges.length) {
      await recordAudit(ctx, {
        refType: 'crm_contact',
        refId: r.id,
        op: 'update',
        changes: auditChanges,
        actor: { id: ctx.profileId ?? null, name: null },
      });
    }
    if (data.phone !== undefined) {
      const digits = (data.phone ?? '').replace(/\D/g, '');
      await tx
        .delete(crmContactIdentities)
        .where(
          and(eq(crmContactIdentities.contactId, id), eq(crmContactIdentities.channel, 'phone')),
        );
      if (digits)
        await tx
          .insert(crmContactIdentities)
          .values({ orgId: ctx.tenantId, contactId: id, channel: 'phone', externalId: digits });
    }
    return r;
  });
  await bustCrmList(ctx.tenantId);
  return row;
}

/** Soft-delete (right-to-erasure first step). */
export async function softDeleteContact(ctx: CoreCtx, id: string) {
  await withOrgCore(ctx, async (tx) => {
    await tx
      .update(crmContacts)
      .set({ deletedAt: new Date() })
      .where(and(eq(crmContacts.id, id), eq(crmContacts.orgId, ctx.tenantId)));
    await recordAudit(ctx, {
      refType: 'crm_contact',
      refId: id,
      op: 'delete',
      changes: [{ field: 'deletedAt', label: 'Deleted', old: null, new: true }],
      actor: { id: ctx.profileId ?? null, name: null },
    });
  });
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

export async function addNote(
  ctx: CoreCtx,
  contactId: string,
  body: string,
  actorId: string | null,
) {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .insert(crmActivities)
      .values({ orgId: ctx.tenantId, contactId, kind: 'note', body, actorId })
      .returning();
    return row;
  });
}

// ── Marketing funnel (acquisition axis; separate from RFM lifecycle) ──────────
// The current stage lives on custom_fields._funnel (reserved key, hidden from
// the Details UI — see crm-meta.isReservedMetaKey). Transitions are logged to
// crm_activities (kind='funnel'). Auto sources only ADVANCE; a human override
// (by='user') may set any stage. See crm-funnel.ts for the pure helpers.

/**
 * Count distinct appointment/payment dates for a contact → the "Loyal" signal
 * (≥2 ⇒ returned & billed again). STUB: billing/appointments are a follow-up
 * feature with no data source wired yet, so this always returns 0 and Loyal is
 * reachable only via manual override for now. The real impl will count distinct
 * dates from billing/appointment events.
 */
export async function distinctVisitDates(_ctx: CoreCtx, _contactId: string): Promise<number> {
  return 0;
}

/**
 * Set a contact's marketing-funnel stage. `by`:
 *  - 'user'  → manual override; pins the stage (auto=false), may move up OR down.
 *  - 'auto'/'agent' → detection; ADVANCE-ONLY (ignored if it wouldn't move the
 *    contact forward) and skipped entirely when a human has pinned the stage.
 * Merges custom_fields._funnel, logs a crm_activities funnel row, busts caches.
 * Returns { applied, stage } — `stage` is the resulting effective stage.
 */
export async function setFunnelStage(
  ctx: CoreCtx,
  contactId: string,
  stage: string,
  opts: { by: 'user' | 'auto' | 'agent'; reason?: string; confidence?: number },
): Promise<{ applied: boolean; stage: string }> {
  if (!isFunnelStage(stage)) throw new Error(`invalid funnel stage: ${stage}`);
  const nowIso = new Date().toISOString();

  const result = await withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .select({ customFields: crmContacts.customFields })
      .from(crmContacts)
      .where(and(eq(crmContacts.id, contactId), eq(crmContacts.orgId, ctx.tenantId)))
      .limit(1);
    if (!row) return null;

    const fields = (row.customFields ?? {}) as Record<string, unknown>;
    const prev = readFunnelMeta(fields);
    const fromStage = prev?.stage ?? null;

    // Respect a human pin: auto/agent never overwrite a manually-set stage.
    if (opts.by !== 'user' && prev && prev.auto === false) {
      return { applied: false, stage: prev.stage };
    }
    // Advance-only for auto/agent.
    if (opts.by !== 'user' && fromStage && funnelStageIndex(stage) <= funnelStageIndex(fromStage)) {
      return { applied: false, stage: fromStage };
    }

    const nextMeta = {
      stage,
      auto: opts.by !== 'user',
      ...(opts.reason != null ? { reason: opts.reason } : {}),
      ...(opts.confidence != null ? { confidence: opts.confidence } : {}),
      ...(opts.by !== 'user' ? { analyzedAt: nowIso } : {}),
      updatedAt: nowIso,
    };
    const nextFields = { ...fields, _funnel: nextMeta };

    await tx
      .update(crmContacts)
      .set({ customFields: nextFields, updatedAt: new Date() })
      .where(and(eq(crmContacts.id, contactId), eq(crmContacts.orgId, ctx.tenantId)));

    await tx.insert(crmActivities).values({
      orgId: ctx.tenantId,
      contactId,
      kind: 'funnel',
      body: null,
      actorId: null,
      data: {
        from: fromStage,
        to: stage,
        by: opts.by,
        reason: opts.reason ?? null,
        confidence: opts.confidence ?? null,
      },
    });

    return { applied: true, stage };
  });

  if (result?.applied) await bustCrmList(ctx.tenantId);
  return result ?? { applied: false, stage };
}

// ── Tags ──────────────────────────────────────────────────────────────────────

export async function listTags(ctx: CoreCtx) {
  return withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(crmTags)
      .where(eq(crmTags.orgId, ctx.tenantId))
      .orderBy(desc(crmTags.position)),
  );
}

export async function createTag(
  ctx: CoreCtx,
  data: { name: string; color?: string | null; kind?: 'manual' | 'auto' | 'ai'; rule?: unknown },
  createdBy: string | null,
) {
  // Reject an auto-tag whose rule won't compile (fail fast, not silently).
  if (data.kind === 'auto' && tryCompileTagRule(data.rule) == null) {
    throw new Error('Invalid auto-tag rule');
  }
  // An AI tag stores its qualification criteria as a free-text description in
  // the `rule` jsonb ({ description }); an agent later evaluates it (see
  // evaluateAiTag) and applies the tag to qualifying contacts.
  if (data.kind === 'ai') {
    const desc = (data.rule as { description?: unknown } | null)?.description;
    if (typeof desc !== 'string' || !desc.trim()) {
      throw new Error('AI tag needs a description of who qualifies');
    }
  }
  const row = await withOrgCore(ctx, async (tx) => {
    const [r] = await tx
      .insert(crmTags)
      .values({
        orgId: ctx.tenantId,
        name: data.name,
        color: data.color ?? null,
        kind: data.kind ?? 'manual',
        rule: (data.rule as object) ?? null,
      })
      .returning();
    return r;
  });
  // An auto-tag is evaluated against the (cached) ranked roster, so a new/removed
  // tag definition must bust the list cache to surface immediately.
  await bustCrmList(ctx.tenantId);
  return row;
}

export async function deleteTag(ctx: CoreCtx, tagId: string) {
  await withOrgCore(ctx, (tx) =>
    tx.delete(crmTags).where(and(eq(crmTags.id, tagId), eq(crmTags.orgId, ctx.tenantId))),
  );
  await bustCrmList(ctx.tenantId);
}

export async function applyTag(
  ctx: CoreCtx,
  contactId: string,
  tagId: string,
  appliedBy: string | null,
) {
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

// ── AI tags ─────────────────────────────────────────────────────────────────
// kind='ai' tags carry a free-text qualification description (rule.description).
// An agent (api/crm/tags/[id]/evaluate) reads each candidate's recent inbound
// messages and applies the tag to those that match. Applications are stored
// like manual tags, so they ride tag_ids / chips / filters with no extra work.

export async function getTag(ctx: CoreCtx, tagId: string) {
  return withOrgCore(ctx, async (tx) => {
    const [t] = await tx
      .select()
      .from(crmTags)
      .where(and(eq(crmTags.id, tagId), eq(crmTags.orgId, ctx.tenantId)))
      .limit(1);
    return t ?? null;
  });
}

export interface AiTagCandidate {
  contactId: string;
  name: string | null;
  snippets: string[];
}

/**
 * Candidates for AI-tag evaluation: contacts with at least one inbound message,
 * each with their most-recent inbound snippets, capped (cost bound). Two bounded
 * queries (candidate ids, then their snippets) instead of N per-contact fetches.
 */
export async function getAiTagCandidates(
  ctx: CoreCtx,
  opts: { cap?: number; perContact?: number } = {},
): Promise<AiTagCandidate[]> {
  const cap = Math.min(opts.cap ?? 120, 300);
  const perContact = Math.min(opts.perContact ?? 3, 8);
  return withOrgCore(ctx, async (tx) => {
    const heads = (await tx.execute(sql`
      select c.id, c.display_name as name
      from crm_contacts c
      join crm_contact_stats s on s.contact_id = c.id
      where c.org_id = ${ctx.tenantId} and c.deleted_at is null and s.inbound_count > 0
      order by s.last_contact_at desc nulls last
      limit ${cap}
    `)) as unknown as Array<{ id: string; name: string | null }>;
    if (heads.length === 0) return [];

    const ids = heads.map((h) => h.id);
    const rows = (await tx.execute(sql`
      select contact_id, body, occurred_at
      from crm_contact_timeline
      where contact_id = any(${ids}) and direction = 'inbound'
        and body is not null and btrim(body) <> ''
      order by occurred_at desc
    `)) as unknown as Array<{ contact_id: string; body: string }>;

    const byContact = new Map<string, string[]>();
    for (const r of rows) {
      const arr = byContact.get(r.contact_id) ?? [];
      if (arr.length < perContact) arr.push(r.body.trim().slice(0, 400));
      byContact.set(r.contact_id, arr);
    }
    return heads.map((h) => ({
      contactId: h.id,
      name: h.name,
      snippets: byContact.get(h.id) ?? [],
    }));
  });
}

/** Apply one tag to many contacts at once (idempotent); busts the list once. */
export async function applyTagBulk(
  ctx: CoreCtx,
  tagId: string,
  contactIds: string[],
): Promise<number> {
  if (contactIds.length === 0) return 0;
  const inserted = await withOrgCore(ctx, async (tx) => {
    const rows = await tx
      .insert(crmContactTags)
      .values(
        contactIds.map((contactId) => ({ orgId: ctx.tenantId, contactId, tagId, appliedBy: null })),
      )
      .onConflictDoNothing()
      .returning({ contactId: crmContactTags.contactId });
    return rows.length;
  });
  if (inserted > 0) await bustCrmList(ctx.tenantId);
  return inserted;
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

// ── Settings & accounts ─────────────────────────────────────────────────────

/** A connected channel account, identified by (channel, accountId). */
export interface AccountRef {
  channel: string;
  accountId: string;
}

export interface CrmSettings {
  /**
   * Accounts explicitly added to the CRM scope. `null` = not yet configured
   * (legacy: every linked account is implicitly in scope). The first
   * add/remove/config action materializes the array (snapshotting the current
   * linked set) so nothing silently drops out.
   */
  accounts: AccountConfig[] | null;
}

/** Stable comparison key for an account ref. */
const accountKey = (channel: string, accountId: string) => `${channel}\u0000${accountId}`;

function parseAccountConfigs(raw: unknown): AccountConfig[] | null {
  if (!Array.isArray(raw)) return null;
  const out: AccountConfig[] = [];
  for (const r of raw) {
    if (r && typeof r === 'object') {
      const o = r as Record<string, unknown>;
      if (typeof o.channel === 'string' && typeof o.accountId === 'string') {
        out.push({
          channel: o.channel,
          accountId: o.accountId,
          label: typeof o.label === 'string' ? o.label : null,
          paused: o.paused === true,
        });
      }
    }
  }
  return out;
}

/** An account the user has explicitly added to the CRM scope, plus its config. */
export interface AccountConfig extends AccountRef {
  label?: string | null;
  paused?: boolean;
}

/**
 * Per-org CRM preferences. Resilient by design: if the `crm_settings` table or
 * the org's row is absent, returns `accounts: null` (legacy — all linked
 * accounts in scope), so harvest + the account manager work even before the
 * migration applies.
 */
export async function getCrmSettings(ctx: CoreCtx): Promise<CrmSettings> {
  try {
    const value = await withOrgCore(ctx, async (tx) => {
      const [row] = await tx
        .select({ value: crmSettings.value })
        .from(crmSettings)
        .where(eq(crmSettings.orgId, ctx.tenantId))
        .limit(1);
      return (row?.value ?? {}) as Record<string, unknown>;
    });
    return { accounts: parseAccountConfigs(value.accounts) };
  } catch {
    return { accounts: null };
  }
}

/**
 * Auto-register a freshly-connected channel account into the CRM harvest
 * scope (called by the Meta connect flow's asset enumeration, per page/IG
 * asset). No-op when the org hasn't materialized an explicit scope yet
 * (`accounts === null` = legacy, every linked account already in scope) —
 * only an explicit scope needs the new account appended. Idempotent: a
 * reconnect that re-enumerates the same page is a no-op the second time.
 */
export async function ensureAccountInScope(
  ctx: CoreCtx,
  channel: string,
  accountId: string,
  name: string | null,
): Promise<void> {
  const { accounts } = await getCrmSettings(ctx);
  if (accounts === null) return;
  const k = accountKey(channel, accountId);
  if (accounts.some((c) => accountKey(c.channel, c.accountId) === k)) return;
  await persistConfigs(ctx, [...accounts, { channel, accountId, label: name, paused: false }]);
}

export interface LedgerAccount {
  channel: string;
  accountId: string;
  /** Distinct eligible inbound senders this account has produced (harvestable). */
  contacts: number;
  lastActive: string | null;
  /** Canonical account name from the live gateway catalog (null if unmatched). */
  name?: string | null;
  /** Linked phone/identity from the gateway catalog (null if unmatched). */
  phone?: string | null;
}

export interface ManagedAccount extends LedgerAccount {
  label: string | null;
  paused: boolean;
}

export interface AccountScope {
  /** Accounts in the CRM scope, enriched with ledger stats + config. */
  added: ManagedAccount[];
  /** Linked accounts not yet added (offered by the "Add" picker). */
  available: LedgerAccount[];
  /** True until the user has explicitly configured the scope. */
  legacy: boolean;
}

/** A live, org-visible channel account from the gateway `channels.status` catalog. */
export interface CatalogAccount {
  channel: string;
  accountId: string;
  name: string | null;
  phone: string | null;
  enabled: boolean;
}

/** The gateway's canonical channel-account catalog, org-scoped. */
export interface ChannelCatalog {
  accounts: CatalogAccount[];
  /** channel → default accountId */
  defaults: Record<string, string>;
}

/**
 * Every connected channel ACCOUNT the org has, derived from the ledger (one row
 * per distinct `(channel, account_id)`) with its distinct-inbound-sender count.
 * This is the universe of linked accounts the user can add to the CRM scope.
 */
export async function listLedgerAccounts(ctx: CoreCtx): Promise<LedgerAccount[]> {
  const rows = (await withOrgCore(ctx, (tx) =>
    tx.execute(sql`
      select channel,
             coalesce(account_id, '') as account_id,
             count(distinct sender_id) filter (where ${ELIGIBLE})::int as contacts,
             max(coalesce(occurred_at, created_at)) as last_active
      from messages m
      where org_id = ${ctx.tenantId}
      group by channel, coalesce(account_id, '')
      order by channel asc, contacts desc, account_id asc
    `),
  )) as unknown as Array<{
    channel: string;
    account_id: string;
    contacts: number;
    last_active: string | null;
  }>;
  return rows.map((r) => ({
    channel: r.channel,
    accountId: r.account_id,
    contacts: Number(r.contacts),
    lastActive: r.last_active,
  }));
}

/** Digits-only key for matching ledger account ids to gateway catalog phones. */
export const normPhone = (v: string | null | undefined): string => (v ?? '').replace(/\D/g, '');

/**
 * The account manager's full view: what's added (with config) + what can be
 * added. The optional live `catalog` (gateway `channels.status`, org-scoped) is
 * merged so accounts show their CANONICAL gateway name/phone instead of a raw
 * id or the generic "Default account", and so freshly-linked accounts that have
 * not yet produced a message still appear in the "Add" picker. When `catalog`
 * is null (gateway unreachable) this degrades to the previous ledger-only view.
 */
export async function getAccountScope(
  ctx: CoreCtx,
  catalog?: ChannelCatalog | null,
): Promise<AccountScope> {
  const [{ accounts }, ledger] = await Promise.all([getCrmSettings(ctx), listLedgerAccounts(ctx)]);
  const byKey = new Map(ledger.map((l) => [accountKey(l.channel, l.accountId), l]));

  const catAccounts = catalog?.accounts ?? [];
  const defaults = catalog?.defaults ?? {};
  const catByKey = new Map(catAccounts.map((a) => [accountKey(a.channel, a.accountId), a]));

  // Resolve a (channel, accountId) to its canonical catalog account, trying:
  // exact id → the channel default (for the 'default'/'' sentinel) → phone match.
  const resolveCanonical = (channel: string, accountId: string): CatalogAccount | undefined => {
    const direct = catByKey.get(accountKey(channel, accountId));
    if (direct) return direct;
    if (!accountId || accountId === 'default') {
      const def = defaults[channel];
      const d = def ? catByKey.get(accountKey(channel, def)) : undefined;
      if (d) return d;
    }
    const digits = normPhone(accountId);
    if (digits) {
      const byPhone = catAccounts.find(
        (c) => c.channel === channel && normPhone(c.phone ?? c.accountId) === digits,
      );
      if (byPhone) return byPhone;
    }
    return undefined;
  };

  // Every catalog account already represented by an added/ledger account, so the
  // "Add" picker doesn't re-offer it under its raw catalog id.
  const coveredCatalogKeys = new Set<string>();
  const enrich = <T extends { channel: string; accountId: string }>(
    a: T,
  ): T & { name: string | null; phone: string | null } => {
    const c = resolveCanonical(a.channel, a.accountId);
    if (c) coveredCatalogKeys.add(accountKey(c.channel, c.accountId));
    return { ...a, name: c?.name ?? null, phone: c?.phone ?? null };
  };

  // Materialize the in-scope set: explicit config, or (legacy) every ledger account.
  const legacy = accounts === null;
  const addedRefs: AccountConfig[] = legacy
    ? ledger.map((l) => ({
        channel: l.channel,
        accountId: l.accountId,
        label: null,
        paused: false,
      }))
    : accounts;

  const addedKeys = new Set(addedRefs.map((a) => accountKey(a.channel, a.accountId)));
  const added: ManagedAccount[] = addedRefs.map((a) => {
    const l = byKey.get(accountKey(a.channel, a.accountId));
    return enrich({
      channel: a.channel,
      accountId: a.accountId,
      label: a.label ?? null,
      paused: !!a.paused,
      contacts: l?.contacts ?? 0,
      lastActive: l?.lastActive ?? null,
    });
  });

  // Available = ledger accounts not yet added + catalog accounts not yet covered
  // (the live source for never-messaged accounts like a freshly-linked number).
  const available: LedgerAccount[] = [];
  const availKeys = new Set<string>();
  const pushAvail = (
    channel: string,
    accountId: string,
    contacts: number,
    lastActive: string | null,
  ) => {
    const k = accountKey(channel, accountId);
    if (addedKeys.has(k) || availKeys.has(k)) return;
    availKeys.add(k);
    available.push(enrich({ channel, accountId, contacts, lastActive }));
  };
  for (const l of ledger) pushAvail(l.channel, l.accountId, l.contacts, l.lastActive);
  for (const c of catAccounts) {
    if (coveredCatalogKeys.has(accountKey(c.channel, c.accountId))) continue;
    pushAvail(c.channel, c.accountId, 0, null);
  }

  return { added, available, legacy };
}

/** Current explicit configs, materializing the legacy "all linked" set on first write. */
async function currentConfigs(ctx: CoreCtx): Promise<AccountConfig[]> {
  const { accounts } = await getCrmSettings(ctx);
  if (accounts !== null) return accounts;
  const ledger = await listLedgerAccounts(ctx);
  return ledger.map((l) => ({
    channel: l.channel,
    accountId: l.accountId,
    label: null,
    paused: false,
  }));
}

async function persistConfigs(ctx: CoreCtx, accounts: AccountConfig[]): Promise<void> {
  const value = { accounts };
  // Shallow jsonb MERGE (||), not replace — crm_settings is a per-org KV shared
  // with other keys (e.g. winAnalysis); replacing `value` would wipe them.
  await withOrgCore(ctx, (tx) =>
    tx
      .insert(crmSettings)
      .values({ orgId: ctx.tenantId, value })
      .onConflictDoUpdate({
        target: crmSettings.orgId,
        set: { value: sql`coalesce(${crmSettings.value}, '{}'::jsonb) || ${JSON.stringify(value)}::jsonb`, updatedAt: new Date() },
      }),
  );
  await bustCrmList(ctx.tenantId);
}

/** Add a linked account to the CRM scope (idempotent). */
export async function addCrmAccount(
  ctx: CoreCtx,
  channel: string,
  accountId: string,
): Promise<void> {
  const configs = await currentConfigs(ctx);
  const k = accountKey(channel, accountId);
  if (!configs.some((c) => accountKey(c.channel, c.accountId) === k)) {
    configs.push({ channel, accountId, label: null, paused: false });
  }
  await persistConfigs(ctx, configs);
}

/** Remove an account from the CRM scope (stops harvesting; existing contacts stay). */
export async function removeCrmAccount(
  ctx: CoreCtx,
  channel: string,
  accountId: string,
): Promise<void> {
  const configs = await currentConfigs(ctx);
  const k = accountKey(channel, accountId);
  await persistConfigs(
    ctx,
    configs.filter((c) => accountKey(c.channel, c.accountId) !== k),
  );
}

/** Patch a scoped account's config (rename / pause). */
export async function updateCrmAccount(
  ctx: CoreCtx,
  channel: string,
  accountId: string,
  patch: { label?: string | null; paused?: boolean },
): Promise<void> {
  const configs = await currentConfigs(ctx);
  const k = accountKey(channel, accountId);
  const next = configs.map((c) =>
    accountKey(c.channel, c.accountId) === k
      ? {
          ...c,
          ...(patch.label !== undefined ? { label: patch.label } : {}),
          ...(patch.paused !== undefined ? { paused: patch.paused } : {}),
        }
      : c,
  );
  await persistConfigs(ctx, next);
}

/** Accounts the harvest should pull from. `all=true` = legacy (every account). */
async function getHarvestScope(ctx: CoreCtx): Promise<{ all: boolean; accounts: AccountRef[] }> {
  const { accounts } = await getCrmSettings(ctx);
  if (accounts === null) return { all: true, accounts: [] };
  return {
    all: false,
    accounts: accounts
      .filter((a) => !a.paused)
      .map((a) => ({ channel: a.channel, accountId: a.accountId })),
  };
}
