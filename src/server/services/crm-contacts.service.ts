import { and, eq, desc, sql } from 'drizzle-orm';
import { cached, invalidateTags, keys, tags } from '@minion-stack/cache';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import { maskPii, sanitizeContactFields } from '$lib/pii';
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
import {
  CONTACT_PARTY,
  contactInvoiceClassSql,
  FIN_PURCHASED,
  FIN_RESERVED_ONLY,
  FIN_LOYAL,
} from './crm-finance.service';
import { readCrmSettingsValue, resolveDepositRule } from './crm-settings.service';
import { scopeData } from './base';
import { depositRuleFingerprint, type DepositRule } from './crm-deposit-rule';
import { bothEnabled } from './modules.service';
import { autoAssign } from './assignment.service';
import { recordAudit } from './activity.service';
import {
  isFunnelStage,
  readFunnelMeta,
  funnelStageIndex,
  FUNNEL_ORDER,
  FUNNEL_LEGACY_ALIASES,
} from '$lib/components/crm/crm-funnel';
import { isReservedMetaKey } from '$lib/components/crm/crm-meta';
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
  /** Lifecycle stage(s) — a single value or a comma-joined list (the DataTable
   *  enum filter multi-select emits `"New,Engaged"`); any listed value matches. */
  stage?: string;
  /** Channel(s) — single value or comma-joined list, same contract as `stage`. */
  channel?: string;
  minScore?: number;
  maxScore?: number;
  tagId?: string;
  /** Restrict to a single contact (used by the detail page to get its score). */
  contactId?: string;
  /** auto-tag rule jsonb (compiled to a live SQL predicate) */
  ruleJson?: unknown;
  search?: string;
  sort?: 'score' | 'recent' | 'frequency' | 'name' | 'revenue' | 'icp';
  /** Sort direction for `sort`. Defaults per key (name asc, everything else
   *  desc — the historical fixed orders). */
  sortDir?: 'asc' | 'desc';
  limit?: number;
  /** Upper bound on `limit`. Defaults to 5000 (the list-page payload cap). The
   *  dashboard raises it so its COUNTS reflect every contact, not a truncated
   *  roster — it aggregates server-side and never ships the rows. */
  maxLimit?: number;
  offset?: number;
  /** Record-level (if-owner) scope: restrict to contacts owned by this profile. */
  ownerId?: string;
  /** Field-level: redact PII in custom_fields (phone/email/dni) for low field level. */
  maskSensitive?: boolean;
  /** Meta lead attribution — comma-joined list of 'ad' | 'organic' | 'none'
   *  ('none' = untracked: lead_origin null or any non-ad/organic value). */
  origin?: string;
  /** DNI-verified flag — comma-joined list of '1' | '0'. */
  verified?: string;
  /** Canonical sex — comma-joined list of 'M' | 'F' (rows with neither are
   *  excluded while the filter is active, matching the column's value domain). */
  sex?: string;
  /** Only contacts whose last message is inbound with no later reply. */
  awaitingReply?: boolean;
  /** Only contacts with a purchase history (any finance invoice). */
  buyerOnly?: boolean;
  /** Only contacts whose invoices are ALL booking deposits — the "reservó pero
   *  no compró" segment. This (NOT buyerOnly) is the server twin of the list's
   *  "reserved" toggle, whose client predicate is `finance.reservedOnly`. */
  reservedOnly?: boolean;
  /** Acquisition-funnel stage — matched against the derived `funnel_stage`
   *  column (chat-derived stage raised by the finance floor). */
  funnelStage?: string;
  /** ICP fit range over custom_fields._icp.score, INCLUSIVE at both endpoints.
   *  Unscored rows carry a NULL score and are excluded while a bound is set. */
  minIcp?: number;
  maxIcp?: number;
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
  /** Per-identity rows (channel + native id) — feeds the merge resolver's channels view. */
  identities: { channel: string; externalId: string | null; handle: string | null }[];
  /** Applied manual-tag ids (for client-side tag filtering). */
  tag_ids: string[];
  /** Custom-field metadata (jsonb) — drives the user-configurable list columns. */
  custom_fields: Record<string, unknown>;
  /** Party-spine link (null when the contact has no reconciled party). */
  party_id: string | null;
  /** parties.dni_verified — identity confirmed against the PERUDEVS DNI registry
   *  (or manually toggled in the customers table). */
  dni_verified: boolean;
  /** Whole-year age derived live from parties.dob; null when dob is unknown.
   *  Overrides custom_fields.edad for display so age never goes stale. */
  age: number | null;
  /** parties.dob as "YYYY-MM-DD" — the STORED fact; `age` above is derived from it. */
  dob: string | null;
  /** Canonical sex from the DNI registry ('M' | 'F' | null). Stored canonical;
   *  the UI localizes to Hombre/Mujer. */
  sex: string | null;
  /** Effective first interaction = earliest of {first message, first purchase}. */
  first_contact_at: string | null;
  /** Effective last interaction = latest of {last message, last purchase}. */
  last_contact_at: string | null;
  /** Has any finance invoice (a prior paying/booking relationship). */
  is_buyer: boolean;
  /** true when the latest message is inbound with no later reply — we owe them. */
  awaiting_reply: boolean;
  /** Meta lead attribution: 'ad' | 'organic' | 'unknown' | null (no attribution row). */
  lead_origin: string | null;
  /** Campaign name when lead_origin = 'ad' (null otherwise/unresolved). */
  lead_campaign: string | null;
  last_days: number;
  reciprocity: number;
  r_score: number;
  f_score: number;
  m_score: number;
  score: number;
  stage: string;
  /** Acquisition-funnel stage, derived in SQL: the stored `custom_fields._funnel`
   *  stage (legacy ids remapped) or `lead` once there is inbound, raised by the
   *  finance floor. The server twin of maxFunnelStage(effectiveFunnelStage(),
   *  financeFloorStage()) — null when nothing has been reached yet. */
  funnel_stage: string | null;
  /** Auto-tag ids whose rule matches this row (computed in the page load, not SQL). */
  auto_tag_ids?: string[];
}

/** One page of ranked contacts plus the total number of rows the SAME filters
 *  match with limit/offset removed — the pager needs both, and the window count
 *  in the outer select gets them in a single round-trip. */
export interface RankedPage {
  rows: RankedContact[];
  total: number;
}

// ICP fit is stored at `custom_fields._icp.score` (written by the ICP scoring
// pipeline — spec 2026-08-03-crm-icp-score). The jsonb_typeof guard means a
// malformed value degrades to NULL instead of aborting the whole query with a
// numeric cast error, and "no ICP data" stays NULL — so `nulls last` sinks
// unscored rows to the bottom rather than ranking them alongside a genuine 0.
const ICP_SCORE_EXPR = sql`(case when jsonb_typeof(custom_fields->'_icp'->'score') = 'number'
                                 then (custom_fields->'_icp'->>'score')::numeric end)`;

// Acquisition funnel, ported into SQL so a page of rows can be filtered by it
// (the client used to derive it per row over the full roster). Built FROM
// FUNNEL_ORDER + FUNNEL_LEGACY_ALIASES so the value domain is the SAME closed set
// the TS helpers use — crm-funnel-parity.sql.integration.test.ts pins them equal.
//
//   chat index  = stored _funnel stage (legacy ids remapped), else 0 ("lead")
//                 once the contact has inbound, else NULL  → effectiveFunnelStage
//   floor index = loyal 3 / purchased 2 / reserved-only 1   → financeFloorStage
//   funnel      = FUNNEL_ORDER[greatest(chat, floor)]       → maxFunnelStage
//
// greatest() ignores NULLs (returning NULL only when both are), which is exactly
// maxFunnelStage's null handling. The jsonb_typeof guard mirrors readFunnelMeta's
// `typeof raw !== 'object'` rejection, so a scalar or missing _funnel degrades to
// the inbound baseline instead of erroring.
const funnelWhens = sql.join(
  [
    ...FUNNEL_ORDER.map((id, i) => sql`when ${id} then ${sql.raw(String(i))}`),
    ...Object.entries(FUNNEL_LEGACY_ALIASES).map(
      ([legacy, id]) => sql`when ${legacy} then ${sql.raw(String(FUNNEL_ORDER.indexOf(id)))}`,
    ),
  ],
  sql` `,
);
const FUNNEL_ORDER_SQL = sql`(array[${sql.join(
  FUNNEL_ORDER.map((id) => sql`${id}::text`),
  sql`, `,
)}])`;
const CHAT_FUNNEL_IDX = sql`coalesce(
  case when jsonb_typeof(custom_fields->'_funnel') = 'object'
       then case custom_fields->'_funnel'->>'stage' ${funnelWhens} else null end end,
  case when inbound_msgs > 0 then 0 end)`;
const FIN_FUNNEL_IDX = sql`(case when fin_loyal then ${sql.raw(String(FUNNEL_ORDER.indexOf('loyal')))}
                                 when fin_purchased then ${sql.raw(String(FUNNEL_ORDER.indexOf('customer')))}
                                 when fin_reserved_only then ${sql.raw(String(FUNNEL_ORDER.indexOf('opportunity')))}
                            end)`;
const FUNNEL_STAGE_EXPR = sql`${FUNNEL_ORDER_SQL}[greatest(${CHAT_FUNNEL_IDX}, ${FIN_FUNNEL_IDX}) + 1]`;

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
export async function rankContactsPage(ctx: CoreCtx, f: RankFilters = {}): Promise<RankedPage> {
  return runRankQuery(ctx, f, await resolveFinanceBridge(ctx));
}

/**
 * Cached page query — the interactive twin of `listContactsCached`. The raw
 * ranking SQL ranks the WHOLE org before LIMIT, which costs tens of seconds on
 * the production dataset (measured 43-57s, FACES, 2026-08-22) — the old roster
 * page only felt fast because its cache hid that. Every distinct
 * (filters, page) result therefore goes through the same Valkey cache +
 * org-tag invalidation as the roster did: ttl 2m keeps pages fresh, swr 1h
 * serves stale while a background refresh recomputes, and any contact mutation
 * busts the org's tags. A never-seen filter combination still pays the raw
 * query once — making the query itself fast is the open follow-up
 * (TODO(handoff): profile/optimize the rank query in prod — see the meta-repo
 * proposal 2026-08-22-crm-rank-query-prod-latency).
 */
export async function rankContactsPageCached(
  ctx: CoreCtx,
  f: RankFilters = {},
): Promise<RankedPage> {
  const finance = await resolveFinanceBridge(ctx);
  // Normalize before fingerprinting so equivalent queries share one entry:
  // limit/offset get their effective defaults (the page load passes offset 0
  // where the API omits it), and maxLimit is dropped — it is a cap, and an
  // equal `limit` yields identical rows under any cap. Without this the SSR
  // load and the first client interaction each paid the raw query for the
  // SAME view. ownerId/maskSensitive live in the tenant key, not the fp.
  const { ownerId, maskSensitive, maxLimit: _cap, ...rest } = f;
  const shape = { ...rest, limit: f.limit ?? 100, offset: f.offset ?? 0 };
  // Stable fingerprint: replacer-array stringify orders keys; undefined
  // values drop out, so {} and {stage: undefined} share an entry.
  const fp = JSON.stringify(shape, Object.keys(shape).sort());
  return cached(
    keys.hub('crm-page', {
      t: `${ctx.tenantId}${ownerId ? `:${ownerId}` : ''}${maskSensitive ? ':m' : ''}`,
      d: scopeData({ fp, rule: depositRuleFingerprint(finance.depositRule) }),
    }),
    { ttl: '2m', swr: '1h', tags: [...crmListTags(ctx.tenantId)] },
    async () => runRankQuery(ctx, f, finance),
  );
}

/**
 * The two settings reads the ranking query's shape depends on: whether the
 * finance bridge is joined at all, and (if so) which deposit rule its
 * classification is built from.
 *
 * Resolved OUTSIDE the ranking transaction on purpose. `bothEnabled` and
 * `resolveDepositRule` each open their own `withOrgCore`, and the RLS pool
 * defaults to ONE connection (`pg-pool.ts` → `getRlsPgClient`): reading them
 * from inside the ranking transaction makes the outer transaction hold the only
 * connection while the inner read waits for a second one — a self-deadlock that
 * a larger pool only downgrades to a concurrency race. Resolve first, pass the
 * result in, open exactly one transaction.
 */
async function resolveFinanceBridge(ctx: CoreCtx): Promise<FinanceBridge> {
  const withFinance = await bothEnabled(ctx, 'crm', 'finances');
  return { withFinance, depositRule: withFinance ? await resolveDepositRule(ctx) : null };
}

interface FinanceBridge {
  withFinance: boolean;
  /** null exactly when `withFinance` is false — no classification is computed. */
  depositRule: DepositRule | null;
}

/** Rows only — the shape every pre-pagination caller (contact-detail score,
 *  /crm/cleanup, the dashboard via listContactsCached) already consumes. */
export async function rankContacts(ctx: CoreCtx, f: RankFilters = {}): Promise<RankedContact[]> {
  return (await rankContactsPage(ctx, f)).rows;
}

async function runRankQuery(
  ctx: CoreCtx,
  f: RankFilters,
  finance: FinanceBridge,
): Promise<RankedPage> {
  return withOrgCore(ctx, async (tx) => {
    const ruleSql = f.ruleJson != null ? tryCompileTagRule(f.ruleJson) : null;

    const conds = [sql`c.deleted_at is null`];
    // Record-level (if-owner) scoping: only the caller's own contacts.
    if (f.ownerId) conds.push(sql`c.owner_id = ${f.ownerId}`);
    if (f.contactId) conds.push(sql`c.id = ${f.contactId}`);
    // display_name stays a substring match; phone + DNI are EXACT-PREFIX (mirrors
    // the gateway `crm_search` tool — a mid-number substring is never what the
    // operator meant).
    //
    // Field-level (Phase 4): a masked principal only ever RECEIVES `•••••4321`,
    // so matching the RAW phone/DNI would hand back exactly the digits the mask
    // hides — `?search=5`, `51`, `519`… narrows until one row survives and the
    // surviving prefix spells the number out. Masked callers therefore keep the
    // pre-pagination display_name-only predicate.
    //
    // p.doc_number is the party-spine DNI search alternative: the `base` CTE
    // below overlays nonblank `parties.doc_number` into `custom_fields.dni` for
    // DISPLAY, so search must match the same authoritative source or a contact
    // whose document lives only on the party spine would render a DNI the
    // roster cannot find.
    if (f.search)
      conds.push(
        f.maskSensitive
          ? sql`c.display_name ilike ${'%' + f.search + '%'}`
          : sql`(c.display_name ilike ${'%' + f.search + '%'}
        or c.custom_fields->>'telefono' like ${f.search + '%'}
        or c.custom_fields->>'dni' like ${f.search + '%'}
        or p.doc_number like ${f.search + '%'})`,
      );
    if (f.tagId)
      conds.push(
        sql`exists (select 1 from crm_contact_tags ct where ct.contact_id = c.id and ct.tag_id = ${f.tagId})`,
      );

    const outer = [sql`true`];
    // Enum filters accept comma-joined multi-select values (the DataTable
    // filter contract); `x = any(string_to_array(v, ','))` ≡ `x = v` for a
    // single value, so single-value callers are unchanged.
    if (f.stage) outer.push(sql`stage = any(string_to_array(${f.stage}, ','))`);
    if (f.channel)
      outer.push(
        sql`exists (select 1 from crm_contact_identities ci2 where ci2.contact_id = contact_id and ci2.channel = any(string_to_array(${f.channel}, ',')))`,
      );
    if (f.origin)
      outer.push(
        sql`(case when lead_origin in ('ad', 'organic') then lead_origin else 'none' end) = any(string_to_array(${f.origin}, ','))`,
      );
    if (f.verified)
      outer.push(
        sql`(case when dni_verified then '1' else '0' end) = any(string_to_array(${f.verified}, ','))`,
      );
    if (f.sex) outer.push(sql`coalesce(sex, '') = any(string_to_array(${f.sex}, ','))`);
    if (typeof f.minScore === 'number') outer.push(sql`score >= ${f.minScore}`);
    if (typeof f.maxScore === 'number') outer.push(sql`score <= ${f.maxScore}`);
    // Filters ported from the client's full-roster predicates (a page of rows is
    // only sufficient once the server applies them).
    if (f.awaitingReply) outer.push(sql`awaiting_reply`);
    if (f.buyerOnly) outer.push(sql`is_buyer`);
    if (f.reservedOnly) outer.push(sql`fin_reserved_only`);
    if (f.funnelStage) outer.push(sql`funnel_stage = any(string_to_array(${f.funnelStage}, ','))`);
    // Range filters are INCLUSIVE at both endpoints (standing governance rule).
    if (typeof f.minIcp === 'number') outer.push(sql`${ICP_SCORE_EXPR} >= ${f.minIcp}`);
    if (typeof f.maxIcp === 'number') outer.push(sql`${ICP_SCORE_EXPR} <= ${f.maxIcp}`);
    if (ruleSql) outer.push(sql.raw(ruleSql)); // vetted: whitelisted columns only

    // Direction is whitelisted to the two literals before sql.raw — never
    // interpolate request input into SQL keywords otherwise.
    const requestedDir = f.sortDir === 'asc' ? 'asc' : f.sortDir === 'desc' ? 'desc' : null;
    const dir = (def: 'asc' | 'desc') => sql.raw(requestedDir ?? def);
    const sortOrder =
      f.sort === 'recent'
        ? sql`last_contact_at ${dir('desc')} nulls last, display_name asc nulls last`
        : f.sort === 'frequency'
          ? sql`total_msgs ${dir('desc')}, display_name asc nulls last`
          : f.sort === 'name'
            ? sql`display_name ${dir('asc')} nulls last`
            : f.sort === 'revenue'
              ? sql`revenue ${dir('desc')} nulls last, display_name asc nulls last`
              : f.sort === 'icp'
                ? sql`${ICP_SCORE_EXPR} ${dir('desc')} nulls last, display_name asc nulls last`
                : sql`score ${dir('desc')}, display_name asc nulls last`;
    const orderBy = sql`${sortOrder}, contact_id asc`;

    const limit = Math.min(f.limit ?? 100, f.maxLimit ?? 5000);
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
    // Both resolved by the caller BEFORE this transaction opened — see
    // resolveFinanceBridge. `depositRule` is the same rule crm-finance.service.ts
    // resolves for this tenant, so the funnel floor computed here can never
    // classify an invoice differently than the ContactFinance flags the detail
    // page renders.
    const { withFinance, depositRule } = finance;
    // contactInvoiceClassSql(rule) is the SAME per-invoice deposit/procedure
    // split contactFinanceMap aggregates, built from the same resolved rule.
    const finCte = withFinance
      ? sql`${contactInvoiceClassSql(depositRule!)},
        fin as (
          select contact_id,
                 min(issued_at) as first_purchase_at,
                 max(issued_at) as last_purchase_at,
                 -- same revenue definition as contactFinanceMap; exists only so
                 -- sort:'revenue' is orderable, and is stripped from the rows below.
                 sum(total)::float8 as revenue,
                 ${FIN_PURCHASED} as fin_purchased,
                 ${FIN_RESERVED_ONLY} as fin_reserved_only,
                 ${FIN_LOYAL} as fin_loyal
          from contact_invoice_class
          group by contact_id
        )`
      : sql`fin as (select null::uuid as contact_id, null::timestamptz as first_purchase_at, null::timestamptz as last_purchase_at, null::float8 as revenue, false as fin_purchased, false as fin_reserved_only, false as fin_loyal where false)`;

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
               -- The PARTY SPINE is authoritative for identity. custom_fields.dni is
               -- import residue: 208 contacts were dni_verified (read from
               -- parties.dni_verified) while their custom_fields.dni was blank, so the
               -- roster showed "verified" next to an empty document. Overlay the real
               -- document so every consumer of custom_fields (list column, detail,
               -- export, merge) agrees, without a data migration.
               case when nullif(trim(p.doc_number), '') is not null
                 then coalesce(c.custom_fields, '{}'::jsonb) || jsonb_build_object('dni', p.doc_number)
                 else c.custom_fields end as custom_fields,
               c.party_id,
               coalesce(p.dni_verified, false) as dni_verified,
               -- Age is ALWAYS derived from dob, never stored (custom_fields.edad is a
               -- frozen import value that silently ages out of date).
               (case when p.dob is not null then date_part('year', age(p.dob))::int end) as age,
               to_char(p.dob, 'YYYY-MM-DD') as dob,
               p.metadata->'dni_registry'->>'sex' as sex,
               coalesce(a.total_msgs, 0) as total_msgs,
               coalesce(a.inbound_msgs, 0) as inbound_msgs,
               coalesce(a.channels_used, 0) as channels_used,
               (select coalesce(array_agg(distinct ci.channel order by ci.channel), array[]::text[])
                  from crm_contact_identities ci where ci.contact_id = c.id) as channels,
               (select coalesce(json_agg(json_build_object('channel', ci.channel, 'externalId', ci.external_id, 'handle', ci.handle)), '[]'::json)
                  from crm_contact_identities ci where ci.contact_id = c.id) as identities,
               (select coalesce(array_agg(ct.tag_id::text), array[]::text[])
                  from crm_contact_tags ct where ct.contact_id = c.id) as tag_ids,
               -- effective first/last interaction = earliest/latest of {message, purchase}
               least(a.first_contact_at, fn.first_purchase_at) as first_contact_at,
               greatest(a.last_contact_at, fn.last_purchase_at) as last_contact_at,
               (fn.first_purchase_at is not null) as is_buyer,
               fn.revenue,
               coalesce(fn.fin_purchased, false) as fin_purchased,
               coalesce(fn.fin_reserved_only, false) as fin_reserved_only,
               coalesce(fn.fin_loyal, false) as fin_loyal,
               attr.origin as lead_origin,
               attr.campaign_name as lead_campaign,
               (a.last_inbound_at is not null and (a.last_outbound_at is null or a.last_inbound_at > a.last_outbound_at)) as awaiting_reply,
               -- message-only recency drives the RFM score (engagement is a messaging axis)
               coalesce(extract(epoch from (now() - a.last_contact_at)) / 86400.0, 1e9) as last_days,
               -- effective recency (msgs + purchases) drives the lifecycle stage + New/Active KPIs
               coalesce(extract(epoch from (now() - greatest(a.last_contact_at, fn.last_purchase_at))) / 86400.0, 1e9) as eff_last_days,
               coalesce(extract(epoch from (now() - least(a.first_contact_at, fn.first_purchase_at))) / 86400.0, 1e9) as eff_first_days,
               coalesce(a.inbound_msgs::numeric / nullif(a.total_msgs, 0), 0) as reciprocity
        from crm_contacts c
        left join parties p on p.id = c.party_id
        left join agg a on a.contact_id = c.id
        left join fin fn on fn.contact_id = c.id
        -- Meta lead attribution (IG today): earliest attribution row across the
        -- contact's identities decides the acquisition origin (ad vs organic).
        left join lateral (
          select la.origin, la.campaign_name
          from crm_contact_identities ci
          join meta_lead_attribution la
            on la.org_id = ci.org_id and la.channel = ci.channel and la.sender_id = ci.external_id
          where ci.contact_id = c.id
          order by la.first_contact_at asc nulls last
          limit 1
        ) attr on true
        where ${and(...conds)}
      ),
      scored as (
        select contact_id, display_name, owner_id, source, channels, identities, tag_ids,
               coalesce(custom_fields, '{}'::jsonb) as custom_fields,
               party_id, dni_verified, age, dob, sex,
               total_msgs, inbound_msgs, channels_used, first_contact_at, last_contact_at, awaiting_reply, is_buyer,
               lead_origin, lead_campaign, revenue,
               fin_reserved_only,
               ${FUNNEL_STAGE_EXPR} as funnel_stage,
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
      ),
      filtered as (
        select * from scored where ${and(...outer)}
      ),
      requested_page as (
        select *, row_number() over (order by ${orderBy}) as page_position
        from filtered
        order by ${orderBy}
        limit ${limit} offset ${offset}
      ),
      filtered_total as (
        select count(*)::int as total_rows from filtered
      )
      select requested_page.*, filtered_total.total_rows
      from filtered_total
      left join requested_page on true
      order by requested_page.page_position
    `);
    // The left join returns one sentinel row when the requested page is empty,
    // preserving the filtered count without a second database round-trip.
    const raw = rows as unknown as (RankedContact & {
      total_rows?: number;
      revenue?: number | null;
      fin_reserved_only?: boolean;
      page_position?: number;
    })[];
    const total = Number(raw[0]?.total_rows) || 0;
    let out: RankedContact[] = raw
      .filter((r) => r.contact_id != null)
      .map((r) => {
        const rest = { ...r };
        delete rest.total_rows;
        delete rest.revenue;
        delete rest.fin_reserved_only;
        delete rest.page_position;
        return rest as RankedContact;
      });
    // pg returns numeric/bigint columns as STRINGS; coerce here so no consumer
    // ever does arithmetic on a digit-string (scoreSum += "50" concatenated its
    // way to avgScore = Infinity on the dashboard).
    out = out.map((r) => ({
      ...r,
      score: Number(r.score) || 0,
      r_score: Number(r.r_score) || 0,
      f_score: Number(r.f_score) || 0,
      m_score: Number(r.m_score) || 0,
      last_days: Number(r.last_days) || 0,
      reciprocity: Number(r.reciprocity) || 0,
      total_msgs: Number(r.total_msgs) || 0,
      inbound_msgs: Number(r.inbound_msgs) || 0,
      channels_used: Number(r.channels_used) || 0,
    }));
    // Age is DERIVED from parties.dob (set by DNI validation); when known it
    // overrides the imported custom_fields.edad so the Age column never goes stale.
    out = out.map((r) =>
      r.age == null ? r : { ...r, custom_fields: { ...r.custom_fields, edad: r.age } },
    );
    // `_relationshipClaim` (AI-inference lease lock) is internal-only — strip
    // it for every caller, masked or not. Field-level (Phase 4): redact PII +
    // `_relationship` in custom_fields (phone/email/dni) for a masked
    // principal — the Customers list renders these as Phone/ID columns.
    out = out.map((r) => ({
      ...r,
      custom_fields: sanitizeContactFields(r.custom_fields, f.maskSensitive ?? false),
    }));
    if (f.maskSensitive)
      out = out.map((r) => ({
        ...r,
        identities: r.identities.map((i) => ({ ...i, externalId: maskPii(i.externalId) })),
      }));
    return { rows: out, total };
  });
}

/** A value that round-trips through `JSON.stringify`/`JSON.parse` unchanged. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * Runtime boundary check for `contactCustomFieldSetSql`/`setContactCustomField`.
 * `JsonValue` at the type level doesn't stop `NaN`/`Infinity` (still `number`)
 * or a value that only *looks* like `JsonValue` because it arrived as `any`
 * from an untyped caller — this walks the actual value and throws before any
 * SQL gets built, instead of letting `JSON.stringify` silently coerce
 * `NaN`/`Infinity` to `null`, silently drop `undefined` (producing no JSON
 * text at all), or throw deep inside `JSON.stringify` on a cyclic reference
 * with no context about which custom-field write caused it.
 */
export function assertJsonValue(
  value: unknown,
  seen = new Set<unknown>(),
): asserts value is JsonValue {
  if (value === null) return;
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return;
  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new Error(`custom field value is not a finite JSON number: ${String(value)}`);
    }
    return;
  }
  if (t !== 'object') {
    throw new Error(`custom field value is not JSON-serializable (${t})`);
  }
  if (seen.has(value)) {
    throw new Error('custom field value is not JSON-serializable (circular reference)');
  }
  if (!Array.isArray(value)) {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new Error('custom field value is not a plain JSON object (unsupported object type)');
    }
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (const item of value) assertJsonValue(item, seen);
      return;
    }
    for (const v of Object.values(value as Record<string, unknown>)) assertJsonValue(v, seen);
  } finally {
    seen.delete(value);
  }
}

/**
 * Pure SQL fragment for the per-key `jsonb_set` merge, split out from
 * `setContactCustomField` so its shape (no `SELECT … custom_fields`, bound
 * path/value params, never `sql.raw`/string interpolation) is unit-testable
 * the same way `customFieldsMergeSql` is — inspect the fragment directly via
 * `PgDialect().sqlToQuery(...)` instead of digging through a mocked chain.
 */
export function contactCustomFieldSetSql(key: string, value: JsonValue) {
  assertJsonValue(value);
  return sql`jsonb_set(coalesce(${crmContacts.customFields}, '{}'::jsonb), ARRAY[${key}]::text[], ${JSON.stringify(value)}::jsonb, true)`;
}

/**
 * Atomic single-key `jsonb_set` on `custom_fields` — the shared primitive
 * behind every reserved-key writer (`_funnel`, `_relationship`, and any
 * future `_icp`). Never reads the column first: this asks Postgres to merge
 * one top-level key in a single statement, so a concurrent writer targeting
 * a different key can never observe or clobber this one, regardless of
 * commit order (the bug this replaces read the whole column into JS, spread
 * it, and wrote the merged object back over the whole column). Takes the
 * caller's own `tx` rather than opening a nested `withOrgCore` transaction,
 * so a writer that also needs a preceding read in the same transaction
 * (e.g. `_funnel`'s forward-only/manual-pin guard) stays one round trip for
 * the write. `guard` (optional) folds an extra WHERE predicate into the same
 * statement so a conditional write ("only if not user-pinned") never needs a
 * separate read either.
 */
export async function setContactCustomField(
  tx: CoreTx,
  orgId: string,
  contactId: string,
  key: string,
  value: JsonValue,
  guard?: ReturnType<typeof sql>,
): Promise<boolean> {
  const rows = await tx
    .update(crmContacts)
    .set({
      customFields: contactCustomFieldSetSql(key, value),
      updatedAt: new Date(),
    })
    .where(
      and(eq(crmContacts.id, contactId), eq(crmContacts.orgId, orgId), ...(guard ? [guard] : [])),
    )
    .returning({ id: crmContacts.id });
  return rows.length > 0;
}

/** Cache tag for an org's CRM contact list — bust on any contact/tag mutation. */
function crmListTags(tenantId: string) {
  return tags.tenantDomain(tenantId, 'crm');
}
/** Invalidate the cached ranked list (call after any mutation that changes it).
 *  Exported for sibling services that write `crm_contacts.custom_fields`
 *  outside this file (e.g. crm-relationship.service.ts). */
export function bustCrmList(tenantId: string) {
  return invalidateTags([...crmListTags(tenantId)]);
}

/**
 * The full ranked roster, Valkey-cached — the single source for BOTH the
 * Customers list (ships the payload; filters/sorts/searches CLIENT-SIDE, instant,
 * no per-keystroke round-trip) AND the dashboard (aggregates counts server-side,
 * returns only stats). Uncapped up to ROSTER_CAP so neither truncates a large org
 * — an ORDER-BY-score-DESC cap at 5000 used to drop the lowest-scoring contacts,
 * under-reporting the dashboard and hiding rows from the list. RFM recency is
 * day-scaled, so a 2m TTL is imperceptible; mutations bust the tag.
 *
 * ponytail: ROSTER_CAP is a safety valve, not a real limit. Past ~50k contacts,
 * shipping the whole roster to the browser stops scaling — that's when the list
 * needs server-side pagination/search and the dashboard a pure SQL COUNT/GROUP BY
 * (no roster materialization). Fine for the current few-thousand scale.
 */
export const ROSTER_CAP = 50_000;
export async function listContactsCached(
  ctx: CoreCtx,
  ownerId?: string,
  maskSensitive = false,
): Promise<RankedContact[]> {
  // Resolved BEFORE the cache lookup, not inside the loader: the roster rows
  // carry fin_purchased/fin_reserved_only and therefore funnel_stage, so a
  // payload built under the previous deposit rule must not survive a
  // same-tenant rule change for the TTL+SWR window. Folding the rule's
  // fingerprint into the key makes the new rule a different entry, so the very
  // next call recomputes instead of serving the stale classification.
  const finance = await resolveFinanceBridge(ctx);
  return cached(
    // Fold owner + mask into the tenant key so an if-owner-scoped or PII-masked
    // caller gets a distinct cached payload (never reads/poisons the org-wide
    // roster). The org-level invalidation tag still busts all on any mutation.
    keys.hub('crm-contacts', {
      t: `${ctx.tenantId}${ownerId ? `:${ownerId}` : ''}${maskSensitive ? ':m' : ''}`,
      d: scopeData({ rule: depositRuleFingerprint(finance.depositRule) }),
    }),
    { ttl: '2m', swr: '30s', tags: [...crmListTags(ctx.tenantId)] },
    async () =>
      (
        await runRankQuery(
          ctx,
          { limit: ROSTER_CAP, maxLimit: ROSTER_CAP, ownerId, maskSensitive },
          finance,
        )
      ).rows,
  );
}

/**
 * Distinct custom_fields keys across the org's live contacts — drives the
 * user-configurable meta columns on /crm/customers WITHOUT scanning the full
 * roster payload (the old client-side collectMetaKeys needed every row shipped).
 * Keys are near-static, so a 10m TTL is fine; contact mutations bust the same
 * org tag as the roster cache anyway.
 */
export async function getMetaKeys(ctx: CoreCtx): Promise<string[]> {
  return cached(
    keys.hub('crm-meta-keys', { t: ctx.tenantId }),
    { ttl: '10m', tags: [...crmListTags(ctx.tenantId)] },
    async () =>
      withOrgCore(ctx, async (tx) => {
        const rows = (await tx.execute(sql`
          select distinct jsonb_object_keys(custom_fields) as key
          from crm_contacts
          where deleted_at is null
          order by 1
        `)) as unknown as { key: string }[];
        return rows.map((r) => r.key);
      }),
  );
}

// ── Single contact + journey ──────────────────────────────────────────────────

export async function getContact(
  ctx: CoreCtx,
  id: string,
  ownerId?: string,
  maskSensitive = false,
) {
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
    // sanitizeContactFields always strips `_relationshipClaim` (internal
    // lease lock, no principal should ever see it) and additionally strips
    // `_relationship` + masks PII when the caller is field-level masked.
    const maskedContact = {
      ...contact,
      customFields: sanitizeContactFields(
        contact.customFields as Record<string, unknown>,
        maskSensitive,
      ),
    };
    const [stats] = (await tx.execute(sql`
      select message_count, inbound_count, channels_used, first_contact_at, last_contact_at
      from crm_contact_stats where contact_id = ${id}
    `)) as unknown as Array<Record<string, unknown>>;
    // Identity comes from the PARTY SPINE, not custom_fields — same authority the
    // roster uses. dob is the stored fact; age is derived here so it can never go
    // stale the way the imported custom_fields.edad did.
    const [party] = (await tx.execute(sql`
      select p.doc_number, to_char(p.dob, 'YYYY-MM-DD') as dob,
             (case when p.dob is not null then date_part('year', age(p.dob))::int end) as age,
             coalesce(p.dni_verified, false) as dni_verified,
             p.metadata->'dni_registry'->>'sex' as sex
      from parties p where p.id = ${contact.partyId ?? null}
    `)) as unknown as Array<{
      doc_number: string | null;
      dob: string | null;
      age: number | null;
      dni_verified: boolean;
      sex: string | null;
    }>;
    return {
      contact: maskedContact,
      identities,
      stats: stats ?? null,
      piiMasked: maskSensitive,
      party: party
        ? {
            docNumber: maskSensitive ? maskPii(party.doc_number ?? '') || null : party.doc_number,
            dob: party.dob,
            age: party.age,
            dniVerified: party.dni_verified,
            sex: party.sex,
          }
        : null,
    };
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
      .where(
        and(eq(crmContactIdentities.contactId, id), eq(crmContactIdentities.channel, 'whatsapp')),
      )
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

/**
 * Client-writable `custom_fields` merge for PATCH (root cause fix, spec R6):
 * a client sending `customFields` used to replace the WHOLE jsonb object,
 * letting it silently delete or forge a `_`-reserved key (`_relationship`,
 * `_relationshipClaim`, `_funnel`, …) that is system-owned. Strips any
 * client-supplied `_`-prefixed key, then merges over whatever reserved keys
 * are already stored on the row — `||`'s right operand wins, and referencing
 * `crmContacts.customFields` inside an UPDATE's SET expression reads the
 * PRE-update row (same trick `atomicSetRelationship` uses), so this is one
 * atomic statement with no pre-image read.
 */
export function customFieldsMergeSql(clientFields: Record<string, unknown>) {
  const stripped = Object.fromEntries(
    Object.entries(clientFields).filter(([k]) => !isReservedMetaKey(k)),
  );
  return sql`coalesce(${JSON.stringify(stripped)}::jsonb, '{}'::jsonb) || coalesce(
    (select jsonb_object_agg(key, value) from jsonb_each(coalesce(${crmContacts.customFields}, '{}'::jsonb)) where left(key, 1) = '_'),
    '{}'::jsonb
  )`;
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
  if (data.customFields !== undefined) set.customFields = customFieldsMergeSql(data.customFields);
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
    // log the new values only, not a before/after diff. `customFields` in `set`
    // is a SQL merge expression (customFieldsMergeSql), not plain data — log
    // the client-submitted value instead so the audit trail stays readable.
    const auditChanges = Object.entries(set)
      .filter(([field]) => field !== 'updatedAt')
      .map(([field, value]) => ({
        field,
        label: field,
        old: null,
        new: field === 'customFields' ? data.customFields : value,
      }));
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
      .for('update')
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

    // The row is locked by the read above until this transaction commits, so
    // no competing funnel writer can change the stage/manual pin between the
    // decision and this write. The write itself only touches `_funnel`.
    await setContactCustomField(tx, ctx.tenantId, contactId, '_funnel', nextMeta);

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
    // Same single `crm_settings` reader resolveDepositRule goes through — one
    // query, one org-scoping/missing-row contract, per-key parsing on top.
    const value = await readCrmSettingsValue(ctx);
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
        set: {
          value: sql`coalesce(${crmSettings.value}, '{}'::jsonb) || ${JSON.stringify(value)}::jsonb`,
          updatedAt: new Date(),
        },
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
