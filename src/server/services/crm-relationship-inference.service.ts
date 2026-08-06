import { sql } from 'drizzle-orm';
import { generateText } from 'ai';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { env } from '$env/dynamic/private';
import type { CoreCtx } from '$server/auth/core-ctx';
import { getCoreDb } from '$server/db/pg-client';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import { getOpenRouterModel } from '$server/llm';
import {
  RELATIONSHIP_CATEGORIES,
  isRelationshipCategory,
  parseRelationshipValue,
  type Relationship,
  type RelationshipCategory,
} from '$lib/components/crm/crm-relationship';
import { setAiRelationship } from './crm-relationship.service';
import type { AccessPrincipal } from './brains.service';
import { searchBrainHybrid, type BrainHybridSearchHit } from './brain-hybrid-retrieval.service';
import { ELIGIBLE_WHERE, chunkConversation, keysValuesList, type ConvoKey } from './crm-conversation-vectors.service';

/**
 * CRM Relationship Graph v2 (spec 2026-07-23) WP2 — the inference kernel — +
 * WP3 — the scheduler/cost-safety wrapper. Follows the
 * crm-conversation-analysis.service.ts template (in-tx candidate select →
 * out-of-tx `generateText` → in-tx write), with the v2-mandated deltas:
 *
 * - Lane 2 (Brain corroboration) uses a narrow CRM-scoped system principal
 *   with `vector:false` — an owner/admin principal with zero canonical
 *   candidates falls into legacy vector search, which THROWS when embeddings
 *   are disabled (spec R1). This principal never has that role, and never
 *   needs the vector lane for proper-name discovery in the first place.
 * - The advisory xact lock the analyze tick uses ends BEFORE the LLM call —
 *   it is not job exclusivity here (the caller wraps N contacts across an
 *   out-of-tx LLM phase). Exclusivity is a per-contact atomic expiring claim
 *   (`custom_fields._relationshipClaim`, jsonb_set with a WHERE-guarded
 *   expiry — same shape as bg-runtime.ts's `leaseUntil` claim, just scoped to
 *   one reserved custom_fields key instead of a dedicated column, since
 *   `_relationship`'s home already IS custom_fields and this needs no
 *   migration). Reserved (`_`-prefixed) → already hidden from the editor and
 *   never touches `_relationship` itself, so a claim can never desync from
 *   `setAiRelationship`'s user-pin guard.
 */

const RELATIONSHIP_INFERENCE_VERSION = 1;
const RELATIONSHIP_MODEL =
  env.CRM_RELATIONSHIP_MODEL ||
  env.CRM_SENTIMENT_MODEL ||
  env.CRM_FUNNEL_MODEL ||
  env.NOTES_POLISH_MODEL ||
  'google/gemini-2.5-flash';

const ORG_CAP = 5;
/** Exported for the tick route's org-loop budget/deadline setup. */
export const GLOBAL_CAP = 25;
const CONCURRENCY = 2;
export const WALL_CLOCK_BUDGET_MS = 4 * 60_000;
const CLAIM_TTL_MS = 5 * 60_000;
const UNKNOWN_COOLDOWN_MS = 7 * 24 * 60 * 60_000;
const CONFIDENCE_THRESHOLD = 0.5;
const CANDIDATE_SCAN_CAP = 200; // headroom above ORG_CAP for the dirty-filter pass
const MAX_CONVERSATIONS_PER_CONTACT = 3;
const HEAD_MESSAGES = 15;
const TAIL_MESSAGES = 15;
// Aggregate prompt cost cap (spec F4): own evidence (head+tail) + corroboration
// combined, ~8k chars total — each bounded separately so neither lane alone
// can blow the combined budget.
const EVIDENCE_CHAR_BUDGET = 6000;
const CORROBORATION_CHAR_BUDGET = 2000;
const CORROBORATION_LIMIT = 8;
const EXTRACT_TIMEOUT_MS = 45_000;
const MAX_OUTPUT_TOKENS = 256;

// ── Pure helpers (unit-testable without DB/LLM) ─────────────────────────────

/** Bind a JS string[] of uuids as a real Postgres uuid[] (mirrors
 *  crm-similarity.service.ts's uuidArray — same interpolation shape). */
function uuidArray(values: string[]) {
  if (values.length === 0) return sql`array[]::uuid[]`;
  return sql`array[${sql.join(values.map((v) => sql`${v}::uuid`), sql`, `)}]::uuid[]`;
}

/**
 * Dirty gate (spec R4): re-run ONLY when the relationship is missing, the
 * aggregated conversation signature or inference version moved, or a past
 * `unknown`/low-confidence verdict (stored as category:'unknown') is older
 * than the cooldown. A `source:'user'` pin is NEVER dirty — the caller should
 * already have excluded it from the candidate set; this is the second,
 * defense-in-depth check.
 */
export function isRelationshipDirty(
  relationship: Relationship | undefined,
  inputSig: string,
  opts: { inferenceVersion: number; cooldownMs: number; now: Date },
): boolean {
  if (!relationship) return true;
  if (relationship.source === 'user') return false;
  if (relationship.inputSig !== inputSig) return true;
  if ((relationship.inferenceVersion ?? 0) !== opts.inferenceVersion) return true;
  if (relationship.category === 'unknown') {
    const updatedAtMs = new Date(relationship.updatedAt).getTime();
    if (!Number.isFinite(updatedAtMs)) return true; // corrupt timestamp — safest to retry
    return opts.now.getTime() - updatedAtMs >= opts.cooldownMs;
  }
  return false;
}

/** Cap application (WP3 caps): at most `orgCap` items, further bounded by
 *  whatever global budget remains. Pure so "caps honored" is a plain array
 *  assertion, no DB needed. */
export function applyCaps<T>(ranked: T[], orgCap: number, remainingBudget: number): T[] {
  return ranked.slice(0, Math.max(0, Math.min(orgCap, remainingBudget)));
}

/** >1 distinct contact sharing the normalized name/alias ⇒ ambiguous (spec R3). */
export function hasAliasCollision(matchingContactCount: number): boolean {
  return matchingContactCount > 1;
}

function normalizeAlias(value: string): string {
  return value.trim().toLocaleLowerCase();
}

/** The CRM-scoped system principal lane 2 must use (spec R1/R3): no
 *  owner/admin roles, no profile/agent identity — just enough
 *  `sourceAccessPredicate` clearance to read WhatsApp-classified chunks
 *  (`requiredModule:'crm', requiredFieldLevel:1` — brain-corpus.service.ts's
 *  `ensureWhatsAppSource`). Zero roles means `searchBrainHybrid` can never
 *  fall into the legacy vector-search fallback that throws when embeddings
 *  are disabled. */
export function relationshipSystemPrincipal(): AccessPrincipal {
  return { searchableModules: ['crm'], fieldLevels: { crm: 1 } };
}

const relationshipLlmOutputSchema = z.object({
  label: z.string().nullable().default(null),
  category: z.string().default('unknown'),
  confidence: z.number().default(0),
  evidenceChunkIds: z.array(z.string()).default([]),
});
type RelationshipLlmOutput = z.infer<typeof relationshipLlmOutputSchema>;

export interface ClampedRelationshipResult {
  label: string | null;
  category: RelationshipCategory;
  confidence: number;
  evidenceChunkIds: string[];
}

/**
 * Applies every output clamp the spec requires (§WP2 point 4): category must
 * be a code enum member else 'unknown'; confidence clamped to [0,1];
 * confidence below threshold forces category:'unknown' + label:null;
 * evidenceChunkIds filtered to ids that were actually offered to the model
 * (rejects invented citations).
 */
export function clampRelationshipResult(
  raw: RelationshipLlmOutput,
  providedChunkIds: ReadonlySet<string>,
): ClampedRelationshipResult {
  const confidence = Number.isFinite(raw.confidence) ? Math.min(1, Math.max(0, raw.confidence)) : 0;
  const category = isRelationshipCategory(raw.category) ? raw.category : 'unknown';
  const evidenceChunkIds = raw.evidenceChunkIds.filter((id) => providedChunkIds.has(id));
  if (confidence < CONFIDENCE_THRESHOLD) {
    return { label: null, category: 'unknown', confidence, evidenceChunkIds };
  }
  return { label: raw.label, category, confidence, evidenceChunkIds };
}

function parseRelationshipLlmOutput(raw: string): RelationshipLlmOutput {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`no JSON object in model output: ${raw.slice(0, 80)}`);
  }
  return relationshipLlmOutputSchema.parse(JSON.parse(raw.slice(start, end + 1)));
}

interface CorroborationHit {
  chunkId: string;
  text: string;
  occurredAt: string | null;
}

/** Exported for testability (prompt-budget assertion) — not a public API. */
export function buildRelationshipPrompt(
  contactName: string,
  ownEvidence: string,
  corroboration: CorroborationHit[],
): string {
  const categoryList = RELATIONSHIP_CATEGORIES.join('|');
  const corroborationBlock =
    corroboration.length > 0
      ? corroboration.map((h) => `[ref: ${h.chunkId}] ${h.text}`).join('\n\n').slice(0, CORROBORATION_CHAR_BUDGET)
      : '(none)';
  return `You infer the REAL personal relationship between a business's contact "${contactName}" and the business owner, from WhatsApp/Instagram/Telegram conversation evidence (Peruvian, mostly Spanish). Examples: mom, dad, sister, friend, friend from work, acquaintance from tennis, service provider, etc. This is NOT a customer-lifecycle stage — it is who this person actually IS to the owner.

Eres un clasificador de relaciones personales REALES (no de etapa de cliente) entre un contacto y el dueño del negocio, a partir de evidencia de conversaciones de WhatsApp/Instagram/Telegram (mayormente en español).

Return ONLY a JSON object (no prose, no markdown fences):
{
  "label": "free-text relationship in the user's own words, e.g. 'amiga del trabajo' (Spanish or English, whatever fits) — or null if you cannot tell",
  "category": one of [${categoryList}],
  "confidence": 0.0-1.0,
  "evidenceChunkIds": ["<chunkId copied EXACTLY from the OTHER-CHAT MENTIONS section below, only if you used it>"]
}
Use "unknown" category + null label + low confidence when the evidence doesn't clearly establish a relationship — do NOT guess. Only cite chunk ids that appear in the OTHER-CHAT MENTIONS section below (never invent one, never cite the OWN CONVERSATION section which has no ids).

=== OWN CONVERSATION with "${contactName}" ===
${ownEvidence || '(no conversation evidence)'}

=== OTHER-CHAT MENTIONS of "${contactName}" (from OTHER conversations — corroboration; may be about someone else with the same name) ===
${corroborationBlock}`;
}

async function classifyRelationship(
  contactName: string,
  ownEvidence: string,
  corroboration: CorroborationHit[],
  deadline: number,
): Promise<ClampedRelationshipResult> {
  const prompt = buildRelationshipPrompt(contactName, ownEvidence, corroboration);
  // Per-call abort timeout (spec F4): never wait longer than the tick's
  // remaining wall-clock budget, capped at the usual per-call ceiling.
  const timeoutMs = Math.max(1, Math.min(EXTRACT_TIMEOUT_MS, deadline - Date.now()));
  const { text: raw } = await generateText({
    model: getOpenRouterModel(RELATIONSHIP_MODEL),
    prompt,
    temperature: 0.2,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    abortSignal: AbortSignal.timeout(timeoutMs),
  });
  const parsed = parseRelationshipLlmOutput(raw);
  const providedChunkIds = new Set(corroboration.map((h) => h.chunkId));
  return clampRelationshipResult(parsed, providedChunkIds);
}

// ── Evidence lane 1 — bounded head+tail sampler ─────────────────────────────

interface HeadTailRow {
  channel: string;
  chat_id: string;
  direction: string;
  content: string | null;
  total: number;
}

/** Bounded per-conversation window: the first `headCount` + last `tailCount`
 *  eligible messages (never the analyze tick's "first chunk of the full
 *  conversation" — that is NOT sufficient here, spec R1). One query for the
 *  whole conversation set via window functions, so N conversations cost one
 *  round trip regardless of how long any of them run. */
async function loadHeadTailRows(
  tx: CoreTx,
  orgId: string,
  keys: ConvoKey[],
  headCount: number,
  tailCount: number,
): Promise<HeadTailRow[]> {
  if (keys.length === 0) return [];
  const rows = await tx.execute(sql`
    with ranked as (
      select m.channel, m.chat_id, m.direction, m.content,
        row_number() over (
          partition by m.channel, m.chat_id
          order by coalesce(m.occurred_at, m.created_at) asc, m.id asc
        ) as rn_asc,
        row_number() over (
          partition by m.channel, m.chat_id
          order by coalesce(m.occurred_at, m.created_at) desc, m.id desc
        ) as rn_desc,
        count(*) over (partition by m.channel, m.chat_id) as total
      from messages m
      where m.org_id = ${orgId} and ${ELIGIBLE_WHERE}
        and (m.channel, m.chat_id) in (${keysValuesList(keys)})
    )
    select channel, chat_id, direction, content, total
    from ranked
    where rn_asc <= ${headCount} or rn_desc <= ${tailCount}
    order by channel, chat_id, rn_asc
  `);
  return rows as unknown as HeadTailRow[];
}

/**
 * Pure formatter: groups the bounded rows back into per-conversation
 * role-tagged text (reusing chunkConversation's tagging/empty-filtering, with
 * an effectively unbounded maxChars so it never re-splits an already-small
 * window), joins head/tail with a `[...]` gap marker only when the
 * conversation was actually truncated (total > headCount + tailCount), and
 * joins conversations with a separator. Char-budgeting across the WHOLE
 * multi-conversation text happens at the call site (slice to
 * EVIDENCE_CHAR_BUDGET) — this function only shapes one conversation set.
 */
export function formatHeadTailEvidence(
  rows: HeadTailRow[],
  headCount: number,
  tailCount: number,
): string {
  const groups = new Map<string, HeadTailRow[]>();
  for (const row of rows) {
    const key = `${row.channel} ${row.chat_id}`;
    const arr = groups.get(key);
    if (arr) arr.push(row);
    else groups.set(key, [row]);
  }
  const blocks: string[] = [];
  for (const groupRows of groups.values()) {
    const total = groupRows[0]?.total ?? groupRows.length;
    const chunkable = groupRows.map((r) => ({ direction: r.direction, content: r.content }));
    const hasGap = total > headCount + tailCount;
    if (hasGap) {
      const head = chunkConversation(chunkable.slice(0, headCount), Number.MAX_SAFE_INTEGER).join('\n');
      const tail = chunkConversation(chunkable.slice(headCount), Number.MAX_SAFE_INTEGER).join('\n');
      const block = [head, '[...]', tail].filter(Boolean).join('\n');
      if (block) blocks.push(block);
    } else {
      const block = chunkConversation(chunkable, Number.MAX_SAFE_INTEGER).join('\n');
      if (block) blocks.push(block);
    }
  }
  return blocks.join('\n\n---\n\n');
}

async function loadOwnEvidence(tx: CoreTx, orgId: string, contactId: string): Promise<string> {
  const convoRows = (await tx.execute(sql`
    select channel, chat_id
    from crm_conversation_index
    where org_id = ${orgId} and contact_id = ${contactId}::uuid
    order by last_occurred_at desc nulls last
    limit ${MAX_CONVERSATIONS_PER_CONTACT}
  `)) as unknown as Array<{ channel: string; chat_id: string }>;
  const keys: ConvoKey[] = convoRows.map((r) => ({ channel: r.channel, chatId: r.chat_id }));
  const rows = await loadHeadTailRows(tx, orgId, keys, HEAD_MESSAGES, TAIL_MESSAGES);
  return formatHeadTailEvidence(rows, HEAD_MESSAGES, TAIL_MESSAGES).slice(0, EVIDENCE_CHAR_BUDGET);
}

// ── Evidence lane 2 — Brain corroboration ───────────────────────────────────

async function countAliasMatches(tx: CoreTx, orgId: string, normalized: string): Promise<number> {
  if (!normalized) return 0;
  const [row] = (await tx.execute(sql`
    select count(distinct c.id)::int as n
    from crm_contacts c
    left join crm_contact_identities ci on ci.contact_id = c.id and ci.org_id = c.org_id
    where c.org_id = ${orgId} and c.deleted_at is null
      and (
        lower(trim(coalesce(c.display_name, ''))) = ${normalized}
        or lower(trim(coalesce(ci.handle, ''))) = ${normalized}
      )
  `)) as unknown as Array<{ n: number }>;
  return Number(row?.n ?? 0);
}

/**
 * Master Brain corroboration (spec R3): connector-filtered, `vector:false`
 * lexical/fuzzy discovery of third-party mentions of this contact's name in
 * OTHER conversations. Skips entirely (returns []) when the name is
 * ambiguous within the org (alias collision) — a semantic-only match is
 * structurally impossible here since the vector lane never runs.
 */
async function loadCorroboration(
  ctx: CoreCtx,
  masterBrainId: string | null,
  displayName: string | null,
  ownWhatsAppExternalIds: ReadonlySet<string>,
): Promise<{ hits: CorroborationHit[]; collision: boolean }> {
  const name = (displayName ?? '').trim();
  if (!masterBrainId || !name) return { hits: [], collision: false };

  const normalized = normalizeAlias(name);
  const matchCount = await withOrgCore(ctx, (tx) => countAliasMatches(tx, ctx.tenantId, normalized));
  if (hasAliasCollision(matchCount)) return { hits: [], collision: true };

  let searchHits: BrainHybridSearchHit[];
  try {
    const result = await searchBrainHybrid(
      ctx,
      masterBrainId,
      name,
      { connectors: ['whatsapp'], vector: false, limit: CORROBORATION_LIMIT },
      relationshipSystemPrincipal(),
    );
    searchHits = result.hits;
  } catch (err) {
    console.error('[crm-relationship-inference] Brain corroboration lookup failed', err);
    return { hits: [], collision: false };
  }

  const hits: CorroborationHit[] = searchHits
    // Defense in depth — vector:false already makes this structurally
    // impossible, but never trust a semantic-only hit for a proper-name search.
    .filter((h) => h.match.eligibility !== 'semantic')
    .filter((h) => {
      const chatId = h.metadata?.['chatId'];
      return !(typeof chatId === 'string' && ownWhatsAppExternalIds.has(chatId));
    })
    .map((h) => ({ chunkId: h.chunkId, text: h.chunkText, occurredAt: h.occurredAt }));
  return { hits, collision: false };
}

// ── Claim (atomic expiring lease scoped to one reserved custom_fields key) ──

interface ClaimResult {
  ids: string[];
  /** Random per-batch lease token (spec F3a) — every write this batch makes
   *  via `setAiRelationship` must present it, so a claim that expired and got
   *  re-acquired by a LATER tick (a new token) can never be overwritten by a
   *  straggling write from THIS one. */
  token: string;
}

async function claimContacts(ctx: CoreCtx, contactIds: string[]): Promise<ClaimResult> {
  if (contactIds.length === 0) return { ids: [], token: '' };
  const token = randomUUID();
  // INTEGER epoch millis (no timestamptz cast) — plain numeric comparison.
  const claim = JSON.stringify({ token, untilEpoch: Date.now() + CLAIM_TTL_MS });
  const rows = await withOrgCore(ctx, (tx) =>
    tx.execute(sql`
      update crm_contacts
      set custom_fields = jsonb_set(coalesce(custom_fields, '{}'::jsonb), '{_relationshipClaim}', ${claim}::jsonb, true)
      where org_id = ${ctx.tenantId} and id = any(${uuidArray(contactIds)})
        and (
          custom_fields->'_relationshipClaim'->>'untilEpoch' is null
          or (custom_fields->'_relationshipClaim'->>'untilEpoch')::bigint < ${Date.now()}
        )
      returning id
    `),
  );
  return { ids: (rows as unknown as Array<{ id: string }>).map((r) => r.id), token };
}

/** Deletes the claim only when `token` still matches — a stale release (this
 *  batch's lease already expired and was re-claimed by a newer one) must
 *  never wipe out that newer claim. */
async function releaseClaims(ctx: CoreCtx, contactIds: string[], token: string): Promise<void> {
  if (contactIds.length === 0) return;
  await withOrgCore(ctx, (tx) =>
    tx.execute(sql`
      update crm_contacts
      set custom_fields = coalesce(custom_fields, '{}'::jsonb) - '_relationshipClaim'
      where org_id = ${ctx.tenantId} and id = any(${uuidArray(contactIds)})
        and custom_fields->'_relationshipClaim'->>'token' = ${token}
    `),
  );
}

// ── Personal-only enforcement (spec R7) ─────────────────────────────────────

/** `organizations` is a global registry table (bypass-role read, same as the
 *  analyze tick's `select id from organizations` and hooks.server.ts's
 *  AUTH_DISABLED lookup) — not org-scoped RLS, so no `withOrgCore` here. */
export async function getOrgKind(orgId: string): Promise<string | null> {
  const rows = (await getCoreDb().execute(
    sql`select kind from organizations where id = ${orgId} limit 1`,
  )) as unknown as Array<{ kind: string | null }>;
  return rows[0]?.kind ?? null;
}

// ── Candidate selection ──────────────────────────────────────────────────────

interface RelationshipCandidate {
  contactId: string;
  relationship: Relationship | undefined;
  inputSig: string;
}

async function selectDirtyCandidates(tx: CoreTx, orgId: string, now: Date): Promise<RelationshipCandidate[]> {
  const rows = (await tx.execute(sql`
    with agg as (
      select c.id as contact_id,
             c.custom_fields->'_relationship' as relationship,
             c.custom_fields->'_relationshipClaim'->>'untilEpoch' as claim_until,
             md5(coalesce(string_agg(coalesce(idx.content_sig, ''), '|' order by idx.channel, idx.chat_id), '')) as input_sig,
             max(idx.last_occurred_at) as last_at,
             coalesce(sum(idx.eligible_count), 0)::int as message_count
      from crm_contacts c
      join crm_conversation_index idx on idx.org_id = c.org_id and idx.contact_id = c.id
      where c.org_id = ${orgId} and c.deleted_at is null
      group by c.id
    )
    select contact_id, relationship, claim_until, input_sig, last_at, message_count
    from agg
    where coalesce(relationship->>'source', '') <> 'user'
    order by last_at desc nulls last, message_count desc
    limit ${CANDIDATE_SCAN_CAP}
  `)) as unknown as Array<{
    contact_id: string;
    relationship: unknown;
    claim_until: string | null;
    input_sig: string;
    last_at: string | null;
    message_count: number;
  }>;

  const out: RelationshipCandidate[] = [];
  for (const row of rows) {
    // A still-live claim from an overlapping tick invocation is not a
    // candidate right now, regardless of dirtiness — claimContacts() would
    // reject it anyway, but skipping it here keeps the ranked list honest.
    // `claim_until` is an epoch-millis string (jsonb `->>` always yields
    // text) — Number(), not Date.parse().
    if (row.claim_until && Number(row.claim_until) > now.getTime()) continue;
    const relationship = parseRelationshipValue(row.relationship);
    if (!isRelationshipDirty(relationship, row.input_sig, { inferenceVersion: RELATIONSHIP_INFERENCE_VERSION, cooldownMs: UNKNOWN_COOLDOWN_MS, now })) {
      continue;
    }
    out.push({ contactId: row.contact_id, relationship, inputSig: row.input_sig });
  }
  return out;
}

interface ContactProfile {
  displayName: string | null;
  whatsAppExternalIds: Set<string>;
}

async function loadContactProfile(tx: CoreTx, orgId: string, contactId: string): Promise<ContactProfile> {
  const [contactRow] = (await tx.execute(
    sql`select display_name from crm_contacts where org_id = ${orgId} and id = ${contactId}::uuid limit 1`,
  )) as unknown as Array<{ display_name: string | null }>;
  const identityRows = (await tx.execute(sql`
    select external_id from crm_contact_identities
    where org_id = ${orgId} and contact_id = ${contactId}::uuid and channel = 'whatsapp'
  `)) as unknown as Array<{ external_id: string }>;
  return {
    displayName: contactRow?.display_name ?? null,
    whatsAppExternalIds: new Set(identityRows.map((r) => r.external_id)),
  };
}

async function getMasterBrainId(tx: CoreTx, orgId: string): Promise<string | null> {
  const [row] = (await tx.execute(
    sql`select id from brains where org_id = ${orgId} and kind = 'master' limit 1`,
  )) as unknown as Array<{ id: string }>;
  return row?.id ?? null;
}

// ── mapWithConcurrency (same shape as crm-conversation-analysis.service.ts —
//    kept local; not worth a shared util for one 15-line helper) ────────────

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const results: Array<{ ok: true; value: R } | { ok: false; error: unknown }> = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { ok: true, value: await fn(items[i]) };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

// ── Tick ─────────────────────────────────────────────────────────────────

export interface RelationshipTickOutcome {
  skipped?: 'not_personal';
  claimed: number;
  processed: number;
  skippedPinned: number;
  skippedCollision: number;
  /** Claimed but the tick's wall-clock deadline hit before the model call —
   *  no write happened at all (spec F4), unlike `skippedPinned`/`unknown`. */
  skippedDeadline: number;
  unknown: number;
  failed: number;
}

const ZERO_OUTCOME: RelationshipTickOutcome = {
  claimed: 0,
  processed: 0,
  skippedPinned: 0,
  skippedCollision: 0,
  skippedDeadline: 0,
  unknown: 0,
  failed: 0,
};

interface ProcessOutcome {
  contactId: string;
  applied: boolean;
  category: RelationshipCategory;
  collision: boolean;
  deadlineSkipped?: boolean;
}

async function processContact(
  ctx: CoreCtx,
  masterBrainId: string | null,
  candidate: RelationshipCandidate,
  claimToken: string,
  deadline: number,
): Promise<ProcessOutcome> {
  const { ownEvidence, profile } = await withOrgCore(ctx, async (tx) => ({
    ownEvidence: await loadOwnEvidence(tx, ctx.tenantId, candidate.contactId),
    profile: await loadContactProfile(tx, ctx.tenantId, candidate.contactId),
  }));
  const { hits: corroboration, collision } = await loadCorroboration(
    ctx,
    masterBrainId,
    profile.displayName,
    profile.whatsAppExternalIds,
  );

  let clamped: ClampedRelationshipResult;
  if (!ownEvidence && corroboration.length === 0) {
    clamped = { label: null, category: 'unknown', confidence: 0, evidenceChunkIds: [] };
  } else if (Date.now() >= deadline) {
    // Deadline recheck (spec F4) — right before the model call, not just at
    // tick entry. No write at all (never marks the contact 'unknown'), so a
    // future tick with budget to spare retries it normally.
    return { contactId: candidate.contactId, applied: false, category: 'unknown', collision, deadlineSkipped: true };
  } else {
    clamped = await classifyRelationship(profile.displayName ?? 'este contacto', ownEvidence, corroboration, deadline);
  }

  const evidenceRefs = clamped.evidenceChunkIds.length
    ? clamped.evidenceChunkIds.map((chunkId) => ({
        chunkId,
        occurredAt: corroboration.find((h) => h.chunkId === chunkId)?.occurredAt ?? undefined,
      }))
    : undefined;

  const { applied } = await setAiRelationship(
    ctx,
    candidate.contactId,
    {
      label: clamped.label,
      category: clamped.category,
      confidence: clamped.confidence,
      inputSig: candidate.inputSig,
      inferenceVersion: RELATIONSHIP_INFERENCE_VERSION,
      model: ownEvidence || corroboration.length ? RELATIONSHIP_MODEL : undefined,
      evidenceRefs,
    },
    claimToken,
  );

  return { contactId: candidate.contactId, applied, category: clamped.category, collision };
}

/**
 * One org's relationship-inference pass. Rechecks org kind itself (fail
 * closed, spec R7) — callers must not rely solely on the tick route's SQL
 * filter. `remainingBudget` is the global per-tick cap still available;
 * `deadline` is the tick's wall-clock cutoff (epoch ms) — no NEW work is
 * claimed once past it, but already-claimed contacts still get their claim
 * released.
 */
export async function relationshipInferenceTick(
  ctx: CoreCtx,
  opts: { remainingBudget: number; deadline: number },
): Promise<RelationshipTickOutcome> {
  if (opts.remainingBudget <= 0 || Date.now() >= opts.deadline) return { ...ZERO_OUTCOME };
  if ((await getOrgKind(ctx.tenantId)) !== 'personal') return { ...ZERO_OUTCOME, skipped: 'not_personal' };
  if (!env.OPENROUTER_API_KEY) return { ...ZERO_OUTCOME };

  const now = new Date();
  const { ranked, masterBrainId } = await withOrgCore(ctx, async (tx) => ({
    ranked: await selectDirtyCandidates(tx, ctx.tenantId, now),
    masterBrainId: await getMasterBrainId(tx, ctx.tenantId),
  }));
  const candidates = applyCaps(ranked, ORG_CAP, opts.remainingBudget);
  if (candidates.length === 0) return { ...ZERO_OUTCOME };

  // Deadline recheck before claim acquisition (spec F4) — candidate selection
  // + master-brain lookup above can itself eat into the budget.
  if (Date.now() >= opts.deadline) return { ...ZERO_OUTCOME };
  const claim = await claimContacts(ctx, candidates.map((c) => c.contactId));
  const claimed = candidates.filter((c) => claim.ids.includes(c.contactId));
  if (claimed.length === 0) return { ...ZERO_OUTCOME };

  const outcomes = await mapWithConcurrency(claimed, CONCURRENCY, (c) =>
    processContact(ctx, masterBrainId, c, claim.token, opts.deadline),
  );

  const totals: RelationshipTickOutcome = { ...ZERO_OUTCOME, claimed: claimed.length };
  outcomes.forEach((o) => {
    if (!o.ok) {
      totals.failed += 1;
      console.error('[crm-relationship-inference] contact classification failed', o.error);
      return;
    }
    if (o.value.deadlineSkipped) {
      totals.skippedDeadline += 1;
      return;
    }
    if (o.value.collision) totals.skippedCollision += 1;
    if (!o.value.applied) {
      totals.skippedPinned += 1;
    } else if (o.value.category === 'unknown') {
      totals.unknown += 1;
    } else {
      totals.processed += 1;
    }
  });

  await releaseClaims(ctx, claimed.map((c) => c.contactId), claim.token);
  return totals;
}
