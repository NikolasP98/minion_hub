import { sql } from 'drizzle-orm';
import { cached, invalidateTags, keys, tags } from '@minion-stack/cache';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { proposeName, nameKey, isUnnamed, type NameIssue } from './crm-standardize';

/**
 * CRM Data Hygiene service: name standardization (deterministic stage 1) +
 * duplicate detection & merge. The LLM "agent review" of the proposals lives in
 * the route (it's an external call). All writes bust the CRM list cache.
 */

function bust(tenantId: string) {
  return invalidateTags([...tags.tenantDomain(tenantId, 'crm')]);
}

/**
 * Cached variants for the hygiene page loads. Both scans are pure functions of
 * the contact roster, so they ride the same `crm` cache tag — any contact
 * mutation (sync / merge / standardize) busts them. Makes repeat navigation to
 * /crm/cleanup instant instead of re-scanning every contact each visit.
 */
export function scanStandardizationCached(ctx: CoreCtx): Promise<NameFix[]> {
  return cached(
    keys.hub('crm-standardize', { t: ctx.tenantId }),
    { ttl: '2m', swr: '30s', tags: [...tags.tenantDomain(ctx.tenantId, 'crm')] },
    () => scanStandardization(ctx),
  );
}

export function findDuplicatesCached(ctx: CoreCtx): Promise<DupGroup[]> {
  return cached(
    keys.hub('crm-duplicates', { t: ctx.tenantId }),
    { ttl: '2m', swr: '30s', tags: [...tags.tenantDomain(ctx.tenantId, 'crm')] },
    () => findDuplicates(ctx),
  );
}

export function findBlanksCached(ctx: CoreCtx): Promise<BlankContact[]> {
  return cached(
    keys.hub('crm-blanks', { t: ctx.tenantId }),
    { ttl: '2m', swr: '30s', tags: [...tags.tenantDomain(ctx.tenantId, 'crm')] },
    () => findBlanks(ctx),
  );
}

// ── Standardization ───────────────────────────────────────────────────────────

export interface NameFix {
  contactId: string;
  current: string | null;
  proposed: string | null;
  issues: NameIssue[];
  needsReview: boolean;
  confidence: number;
}

/** Scan all contacts; return only those whose name changes or has an issue, most-confident first. */
export async function scanStandardization(ctx: CoreCtx): Promise<NameFix[]> {
  const rows = (await withOrgCore(ctx, (tx) =>
    tx.execute(sql`
      select id, display_name from crm_contacts
      where org_id = ${ctx.tenantId} and deleted_at is null
    `),
  )) as unknown as Array<{ id: string; display_name: string | null }>;

  const fixes: NameFix[] = [];
  for (const r of rows) {
    if (isUnnamed(r.display_name)) continue; // blank/1-char/emoji-only → "Needs a name" section
    const p = proposeName(r.display_name);
    const changed = (p.proposed ?? '') !== (r.display_name ?? '');
    if (changed || p.issues.length > 0) {
      fixes.push({
        contactId: r.id,
        current: r.display_name,
        proposed: p.proposed,
        issues: p.issues,
        needsReview: p.needsReview,
        confidence: p.confidence,
      });
    }
  }
  // Highest-confidence fixes first (clear casing/emoji at top, ambiguous junk at bottom).
  fixes.sort((a, b) => b.confidence - a.confidence);
  return fixes;
}

/** Apply chosen name fixes (each { contactId, name, before? }). Returns count updated. */
export async function applyStandardization(
  ctx: CoreCtx,
  fixes: Array<{ contactId: string; name: string; before?: string | null }>,
): Promise<number> {
  if (fixes.length === 0) return 0;
  // Trim + drop empties first (same skip the per-row loop did); count = number of
  // valid fixes submitted (unchanged from the loop, which incremented per attempt).
  const valid = fixes
    .map((f) => ({ id: f.contactId, name: f.name.trim(), before: (f.before ?? '').trim() }))
    .filter((f) => f.name);
  if (valid.length === 0) {
    await bust(ctx.tenantId);
    return 0;
  }
  await withOrgCore(ctx, async (tx) => {
    const rows = sql.join(
      valid.map((f) => sql`(${f.id}::uuid, ${f.name})`),
      sql`, `,
    );
    await tx.execute(sql`
      update crm_contacts c set display_name = v.name, updated_at = now()
      from (values ${rows}) as v(id, name)
      where c.id = v.id and c.org_id = ${ctx.tenantId}
    `);
    // Log the before→after pairs as training data for future AI reviews (reuses
    // crm_activities; only real changes). Best-effort — never blocks the rename.
    const examples = valid.filter((f) => f.before && f.before !== f.name);
    if (examples.length > 0) {
      await tx.execute(sql`
        insert into crm_activities (org_id, contact_id, kind, data)
        values ${sql.join(
          examples.map(
            (e) => sql`(${ctx.tenantId}, ${e.id}::uuid, 'name_fix', ${JSON.stringify({ before: e.before, after: e.name })}::jsonb)`,
          ),
          sql`, `,
        )}
      `);
    }
  });
  await bust(ctx.tenantId);
  return valid.length;
}

/** Recent accepted before→after name fixes for this org — few-shot examples for AI review. */
export async function recentNameFixes(ctx: CoreCtx, limit = 40): Promise<Array<{ before: string; after: string }>> {
  const rows = (await withOrgCore(ctx, (tx) =>
    tx.execute(sql`
      select distinct on (data->>'before') data->>'before' as before, data->>'after' as after
      from crm_activities
      where org_id = ${ctx.tenantId} and kind = 'name_fix'
        and nullif(data->>'before','') is not null and nullif(data->>'after','') is not null
      order by data->>'before', occurred_at desc
      limit ${limit}
    `),
  )) as unknown as Array<{ before: string; after: string }>;
  return rows;
}

// ── Duplicate detection ───────────────────────────────────────────────────────

export interface ContactIdentity {
  channel: string;
  /** Display value (handle-preferred) — used by the inline dup/blank lists. */
  value: string;
  /** Channel-native id (phone / external id) — the resolver shows this, formatted. */
  externalId?: string | null;
  handle?: string | null;
}
export interface DupContact {
  id: string;
  name: string | null;
  dni: string | null;
  phone: string | null;
  score: number;
  messages: number;
  /** Channel identities (phone/handle) — lets a human confirm a name match is a real dupe. */
  identities: ContactIdentity[];
  /** Full custom_fields jsonb — feeds the field-by-field merge resolver. */
  customFields: Record<string, unknown>;
}
export interface DupGroup {
  reason: 'dni' | 'name';
  key: string;
  contacts: DupContact[];
  /** 0..1: identical DNI is strong; same-name with conflicting numbers is weak (likely NOT a dupe). */
  confidence: number;
}

/** All distinct phone-like numbers a contact exposes (custom telefono + numeric identities). */
function contactNumbers(c: DupContact): Set<string> {
  const nums = new Set<string>();
  const norm = (v: string) => v.replace(/\D/g, '');
  if (c.phone && norm(c.phone).length >= 6) nums.add(norm(c.phone));
  for (const id of c.identities) if (norm(id.value).length >= 6) nums.add(norm(id.value));
  return nums;
}

/** Confidence for a same-name group: low when the key is junk or members hold different numbers. */
function nameGroupConfidence(key: string, contacts: DupContact[]): number {
  // Junk key (".", single char, all-punctuation) — same "name" means nothing.
  if (key.replace(/[^\p{L}\p{N}]/gu, '').length < 2) return 0.15;
  const distinct = new Set<string>();
  for (const c of contacts) for (const n of contactNumbers(c)) distinct.add(n);
  // ≥2 distinct numbers across members ⇒ different people who happen to share a name.
  if (distinct.size > 1) return 0.3;
  return 0.6;
}

/**
 * Find likely-duplicate groups. Strong signal = identical DNI (national id);
 * secondary = identical normalized name. Groups are deduped (a pair sharing both
 * DNI and name reports once, under DNI) and sorted most-confident first.
 */
export async function findDuplicates(ctx: CoreCtx): Promise<DupGroup[]> {
  const rows = (await withOrgCore(ctx, (tx) =>
    tx.execute(sql`
      with msgs as (
        select ci.contact_id, count(*) n
        from crm_contact_identities ci
        join messages m on m.org_id = ci.org_id and m.channel = ci.channel and m.chat_id = ci.external_id
        where m.is_bot is not true group by ci.contact_id
      )
      select c.id, c.display_name,
             nullif(c.custom_fields->>'dni','') as dni,
             nullif(c.custom_fields->>'telefono','') as phone,
             coalesce(c.custom_fields, '{}'::jsonb) as custom_fields,
             coalesce(mm.n, 0) as messages,
             coalesce(ids.list, '[]'::json) as identities
      from crm_contacts c
      left join msgs mm on mm.contact_id = c.id
      left join lateral (
        select json_agg(json_build_object('channel', i.channel, 'value', coalesce(nullif(i.handle,''), i.external_id), 'externalId', i.external_id, 'handle', i.handle)) as list
        from crm_contact_identities i
        where i.org_id = c.org_id and i.contact_id = c.id
      ) ids on true
      where c.org_id = ${ctx.tenantId} and c.deleted_at is null
    `),
  )) as unknown as Array<{
    id: string;
    display_name: string | null;
    dni: string | null;
    phone: string | null;
    custom_fields: Record<string, unknown> | null;
    messages: number;
    identities: ContactIdentity[] | null;
  }>;

  const mk = (r: (typeof rows)[number]): DupContact => ({
    id: r.id,
    name: r.display_name,
    dni: r.dni,
    phone: r.phone,
    score: 0,
    messages: Number(r.messages) || 0,
    identities: (Array.isArray(r.identities) ? r.identities : []).filter((i) => i && i.value),
    customFields: r.custom_fields && typeof r.custom_fields === 'object' ? r.custom_fields : {},
  });

  const byDni = new Map<string, DupContact[]>();
  const byName = new Map<string, DupContact[]>();
  for (const r of rows) {
    if (r.dni) (byDni.get(r.dni) ?? byDni.set(r.dni, []).get(r.dni)!).push(mk(r));
    const nk = nameKey(r.display_name);
    if (nk) (byName.get(nk) ?? byName.set(nk, []).get(nk)!).push(mk(r));
  }

  const groups: DupGroup[] = [];
  const seen = new Set<string>(); // contact ids already grouped under DNI
  for (const [key, contacts] of byDni) {
    if (contacts.length > 1) {
      groups.push({ reason: 'dni', key, contacts, confidence: 0.9 });
      contacts.forEach((c) => seen.add(c.id));
    }
  }
  for (const [key, contacts] of byName) {
    const fresh = contacts.filter((c) => !seen.has(c.id));
    if (fresh.length > 1) {
      groups.push({ reason: 'name', key, contacts: fresh, confidence: nameGroupConfidence(key, fresh) });
    }
  }
  // Most-confident first; tie-break on bigger groups.
  groups.sort((a, b) => b.confidence - a.confidence || b.contacts.length - a.contacts.length);
  return groups;
}

// ── Blank / unnamed contacts (manual fixing) ────────────────────────────────────

export interface BlankContact {
  id: string;
  name: string | null;
  dni: string | null;
  phone: string | null;
  messages: number;
  identities: ContactIdentity[];
}

/**
 * Contacts with ≤1 alphanumeric char in their name (blank, ".", single letter,
 * emoji-only) — un-auto-fixable, surfaced for MANUAL naming with cross-reference
 * metadata (phone/DNI/channel identities). Most-active first.
 */
export async function findBlanks(ctx: CoreCtx): Promise<BlankContact[]> {
  const rows = (await withOrgCore(ctx, (tx) =>
    tx.execute(sql`
      with msgs as (
        select ci.contact_id, count(*) n
        from crm_contact_identities ci
        join messages m on m.org_id = ci.org_id and m.channel = ci.channel and m.chat_id = ci.external_id
        where m.is_bot is not true group by ci.contact_id
      )
      select c.id, c.display_name,
             nullif(c.custom_fields->>'dni','') as dni,
             nullif(c.custom_fields->>'telefono','') as phone,
             coalesce(mm.n, 0) as messages,
             coalesce(ids.list, '[]'::json) as identities
      from crm_contacts c
      left join msgs mm on mm.contact_id = c.id
      left join lateral (
        select json_agg(json_build_object('channel', i.channel, 'value', coalesce(nullif(i.handle,''), i.external_id), 'externalId', i.external_id, 'handle', i.handle)) as list
        from crm_contact_identities i
        where i.org_id = c.org_id and i.contact_id = c.id
      ) ids on true
      where c.org_id = ${ctx.tenantId} and c.deleted_at is null
        and char_length(regexp_replace(coalesce(c.display_name, ''), '[^[:alnum:]]+', '', 'g')) <= 1
      order by coalesce(mm.n, 0) desc
    `),
  )) as unknown as Array<{
    id: string;
    display_name: string | null;
    dni: string | null;
    phone: string | null;
    messages: number;
    identities: ContactIdentity[] | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    name: r.display_name,
    dni: r.dni,
    phone: r.phone,
    messages: Number(r.messages) || 0,
    identities: (Array.isArray(r.identities) ? r.identities : []).filter((i) => i && i.value),
  }));
}

/**
 * Merge `loserIds` into `survivorId`: reassign identities / activities / tags,
 * backfill missing custom_fields onto the survivor, then delete the losers.
 * Idempotent-ish (deleting an already-merged loser is a no-op).
 */
export async function mergeContacts(
  ctx: CoreCtx,
  survivorId: string,
  loserIds: string[],
  /** Conflict-resolver overrides applied to the survivor AFTER the backfill —
   *  these win over both survivor and loser values. `customFields` is jsonb-merged
   *  (never a wholesale replace), so untouched keys are preserved. */
  overrides?: { displayName?: string; customFields?: Record<string, unknown> },
): Promise<void> {
  const losers = loserIds.filter((id) => id && id !== survivorId);
  if (losers.length === 0) return;

  await withOrgCore(ctx, async (tx) => {
    const org = ctx.tenantId;
    const loserArr = sql`(${sql.join(
      losers.map((id) => sql`${id}`),
      sql`, `,
    )})`;

    // 1. Drop loser identities that would collide with one the survivor already has.
    await tx.execute(sql`
      delete from crm_contact_identities li
      using crm_contact_identities si
      where li.org_id = ${org} and li.contact_id in ${loserArr}
        and si.contact_id = ${survivorId}
        and si.channel = li.channel and si.external_id = li.external_id
    `);
    // 2. Reassign remaining loser identities → survivor.
    await tx.execute(sql`
      update crm_contact_identities set contact_id = ${survivorId}
      where org_id = ${org} and contact_id in ${loserArr}
    `);
    // 3. Reassign activities.
    await tx.execute(sql`
      update crm_activities set contact_id = ${survivorId}
      where org_id = ${org} and contact_id in ${loserArr}
    `);
    // 4. Reassign tags (skip ones the survivor already has).
    await tx.execute(sql`
      insert into crm_contact_tags (org_id, contact_id, tag_id, applied_by, applied_at)
      select ${org}, ${survivorId}, tag_id, applied_by, applied_at
      from crm_contact_tags where org_id = ${org} and contact_id in ${loserArr}
      on conflict (contact_id, tag_id) do nothing
    `);
    // 5. Backfill missing custom_fields onto the survivor (survivor's values win:
    //    losers_merged || survivor → right operand overrides on key clash).
    await tx.execute(sql`
      update crm_contacts s set custom_fields = (
        select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) || s.custom_fields
        from (
          select distinct on (key) key, value
          from crm_contacts lc, jsonb_each(lc.custom_fields)
          where lc.org_id = ${org} and lc.id in ${loserArr}
          order by key
        ) loser_fields
      )
      where s.id = ${survivorId} and s.org_id = ${org}
    `);
    // 5b. Apply the user's conflict-resolver choices — these OVERRIDE the survivor
    //     (jsonb `||` right-operand wins; untouched keys survive).
    if (overrides) {
      const sets: ReturnType<typeof sql>[] = [];
      if (overrides.displayName != null && overrides.displayName !== '')
        sets.push(sql`display_name = ${overrides.displayName}`);
      if (overrides.customFields && Object.keys(overrides.customFields).length > 0)
        sets.push(sql`custom_fields = coalesce(custom_fields, '{}'::jsonb) || ${JSON.stringify(overrides.customFields)}::jsonb`);
      if (sets.length)
        await tx.execute(sql`
          update crm_contacts set ${sql.join(sets, sql`, `)}
          where id = ${survivorId} and org_id = ${org}
        `);
    }
    // 6. Delete losers (their now-orphan rows already reassigned).
    await tx.execute(sql`
      delete from crm_contacts where org_id = ${org} and id in ${loserArr}
    `);
  });
  await bust(ctx.tenantId);
}
