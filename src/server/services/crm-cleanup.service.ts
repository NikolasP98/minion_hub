import { sql } from 'drizzle-orm';
import { invalidateTags, tags } from '@minion-stack/cache';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { proposeName, nameKey, type NameIssue } from './crm-standardize';

/**
 * CRM Data Hygiene service: name standardization (deterministic stage 1) +
 * duplicate detection & merge. The LLM "agent review" of the proposals lives in
 * the route (it's an external call). All writes bust the CRM list cache.
 */

function bust(tenantId: string) {
  return invalidateTags([...tags.tenantDomain(tenantId, 'crm')]);
}

// ── Standardization ───────────────────────────────────────────────────────────

export interface NameFix {
  contactId: string;
  current: string | null;
  proposed: string | null;
  issues: NameIssue[];
  needsReview: boolean;
}

/** Scan all contacts; return only those whose name changes or has an issue. */
export async function scanStandardization(ctx: CoreCtx): Promise<NameFix[]> {
  const rows = (await withOrgCore(ctx, (tx) =>
    tx.execute(sql`
      select id, display_name from crm_contacts
      where org_id = ${ctx.tenantId} and deleted_at is null
    `),
  )) as unknown as Array<{ id: string; display_name: string | null }>;

  const fixes: NameFix[] = [];
  for (const r of rows) {
    const p = proposeName(r.display_name);
    const changed = (p.proposed ?? '') !== (r.display_name ?? '');
    if (changed || p.issues.length > 0) {
      fixes.push({
        contactId: r.id,
        current: r.display_name,
        proposed: p.proposed,
        issues: p.issues,
        needsReview: p.needsReview,
      });
    }
  }
  return fixes;
}

/** Apply chosen name fixes (each { contactId, name }). Returns count updated. */
export async function applyStandardization(
  ctx: CoreCtx,
  fixes: Array<{ contactId: string; name: string }>,
): Promise<number> {
  if (fixes.length === 0) return 0;
  const n = await withOrgCore(ctx, async (tx) => {
    let count = 0;
    for (const f of fixes) {
      const name = f.name.trim();
      if (!name) continue;
      await tx.execute(sql`
        update crm_contacts set display_name = ${name}, updated_at = now()
        where id = ${f.contactId} and org_id = ${ctx.tenantId}
      `);
      count++;
    }
    return count;
  });
  await bust(ctx.tenantId);
  return n;
}

// ── Duplicate detection ───────────────────────────────────────────────────────

export interface DupContact {
  id: string;
  name: string | null;
  dni: string | null;
  phone: string | null;
  score: number;
  messages: number;
}
export interface DupGroup {
  reason: 'dni' | 'name';
  key: string;
  contacts: DupContact[];
}

/**
 * Find likely-duplicate groups. Strong signal = identical DNI (national id);
 * secondary = identical normalized name. Groups are deduped (a pair sharing both
 * DNI and name reports once, under DNI).
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
             coalesce(mm.n, 0) as messages
      from crm_contacts c
      left join msgs mm on mm.contact_id = c.id
      where c.org_id = ${ctx.tenantId} and c.deleted_at is null
    `),
  )) as unknown as Array<{
    id: string;
    display_name: string | null;
    dni: string | null;
    phone: string | null;
    messages: number;
  }>;

  const mk = (r: (typeof rows)[number]): DupContact => ({
    id: r.id,
    name: r.display_name,
    dni: r.dni,
    phone: r.phone,
    score: 0,
    messages: Number(r.messages) || 0,
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
      groups.push({ reason: 'dni', key, contacts });
      contacts.forEach((c) => seen.add(c.id));
    }
  }
  for (const [key, contacts] of byName) {
    const fresh = contacts.filter((c) => !seen.has(c.id));
    if (fresh.length > 1) groups.push({ reason: 'name', key, contacts: fresh });
  }
  // Most-actionable first: bigger groups, DNI before name.
  groups.sort((a, b) => b.contacts.length - a.contacts.length);
  return groups;
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
): Promise<void> {
  const losers = loserIds.filter((id) => id && id !== survivorId);
  if (losers.length === 0) return;

  await withOrgCore(ctx, async (tx) => {
    const org = ctx.tenantId;
    const loserArr = sql`(${sql.join(losers.map((id) => sql`${id}`), sql`, `)})`;

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
    // 6. Delete losers (their now-orphan rows already reassigned).
    await tx.execute(sql`
      delete from crm_contacts where org_id = ${org} and id in ${loserArr}
    `);
  });
  await bust(ctx.tenantId);
}
