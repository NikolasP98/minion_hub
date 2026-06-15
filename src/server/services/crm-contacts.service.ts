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
  crmSettings,
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

    // When scoring a single contact (detail page), push its id into the agg CTE
    // so we aggregate only that contact's conversation — not the whole roster.
    const aggWhere = f.contactId
      ? sql`where m.is_bot is not true and ci.contact_id = ${f.contactId}`
      : sql`where m.is_bot is not true`;

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
          -- match the whole conversation (chat_id), not just msgs the contact sent
          on m.org_id = ci.org_id and m.channel = ci.channel and m.chat_id = ci.external_id
        ${aggWhere}
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
const accountKey = (channel: string, accountId: string) => `${channel} ${accountId}`;

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

export interface LedgerAccount {
  channel: string;
  accountId: string;
  /** Distinct eligible inbound senders this account has produced (harvestable). */
  contacts: number;
  lastActive: string | null;
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

/** The account manager's full view: what's added (with config) + what can be added. */
export async function getAccountScope(ctx: CoreCtx): Promise<AccountScope> {
  const [{ accounts }, ledger] = await Promise.all([getCrmSettings(ctx), listLedgerAccounts(ctx)]);
  const byKey = new Map(ledger.map((l) => [accountKey(l.channel, l.accountId), l]));

  if (accounts === null) {
    return {
      added: ledger.map((l) => ({ ...l, label: null, paused: false })),
      available: [],
      legacy: true,
    };
  }

  const addedKeys = new Set(accounts.map((a) => accountKey(a.channel, a.accountId)));
  const added: ManagedAccount[] = accounts.map((a) => {
    const l = byKey.get(accountKey(a.channel, a.accountId));
    return {
      channel: a.channel,
      accountId: a.accountId,
      label: a.label ?? null,
      paused: !!a.paused,
      contacts: l?.contacts ?? 0,
      lastActive: l?.lastActive ?? null,
    };
  });
  const available = ledger.filter((l) => !addedKeys.has(accountKey(l.channel, l.accountId)));
  return { added, available, legacy: false };
}

/** Current explicit configs, materializing the legacy "all linked" set on first write. */
async function currentConfigs(ctx: CoreCtx): Promise<AccountConfig[]> {
  const { accounts } = await getCrmSettings(ctx);
  if (accounts !== null) return accounts;
  const ledger = await listLedgerAccounts(ctx);
  return ledger.map((l) => ({ channel: l.channel, accountId: l.accountId, label: null, paused: false }));
}

async function persistConfigs(ctx: CoreCtx, accounts: AccountConfig[]): Promise<void> {
  const value = { accounts };
  await withOrgCore(ctx, (tx) =>
    tx
      .insert(crmSettings)
      .values({ orgId: ctx.tenantId, value })
      .onConflictDoUpdate({ target: crmSettings.orgId, set: { value, updatedAt: new Date() } }),
  );
  await bustCrmList(ctx.tenantId);
}

/** Add a linked account to the CRM scope (idempotent). */
export async function addCrmAccount(ctx: CoreCtx, channel: string, accountId: string): Promise<void> {
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
