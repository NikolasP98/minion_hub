import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import { parties, type Party } from '$server/db/pg-party-schema';
import { crmContacts } from '$server/db/pg-crm-schema';
import type { CoreCtx } from '$server/auth/core-ctx';

/**
 * Party spine service. The dedup keys mirror the existing CRM↔Finance phone
 * bridge: a party is identified within an org by document number (strong) or by
 * the last-9-digits phone (Peru). ensureParty is the promotion of that
 * query-time join into a stored identity.
 *
 * NOT YET WIRED: harvest (crm-contacts.service) and SUSII sync
 * (finance-sync.service) still create their facet rows without calling
 * ensureParty, and existing rows have party_id = null. Backfill + call-site
 * wiring is the next step (see linkContactParty + a one-off backfill script).
 * ponytail: scaffold the spine first; don't rewrite two hot ingest paths until
 * the Connections panel proves the shape is right.
 */

/** Last-9-digits phone key (Peru), matching crm-finance.service's SQL PHONE9.
 *  Returns null when fewer than 8 digits remain (too short to be a real match). */
export function phone9(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length < 8) return null;
  return digits.slice(-9);
}

export interface EnsurePartyInput {
  type?: 'person' | 'company';
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  docType?: string | null;
  docNumber?: string | null;
}

/**
 * Find-or-create a party by its dedup keys (doc_number first, then phone9).
 * Fills in any newly-known name/email/phone on an existing match. Returns the
 * party. Run inside one withOrgCore txn so the read+write can't race a sibling.
 */
export async function ensureParty(ctx: CoreCtx, input: EnsurePartyInput): Promise<Party> {
  const p9 = phone9(input.phone);
  const doc = input.docNumber?.trim() || null;
  return withOrgCore(ctx, async (tx) => {
    // Strong key first (document), then phone. A party with neither key is still
    // creatable (e.g. name-only walk-in) but won't dedup — acceptable.
    let existing: Party | undefined;
    if (doc) {
      [existing] = await tx
        .select()
        .from(parties)
        .where(and(eq(parties.orgId, ctx.tenantId), eq(parties.docNumber, doc)))
        .limit(1);
    }
    if (!existing && p9) {
      [existing] = await tx
        .select()
        .from(parties)
        .where(and(eq(parties.orgId, ctx.tenantId), eq(parties.phone9, p9)))
        .limit(1);
    }

    if (existing) {
      // Backfill any field we now know but didn't before. COALESCE keeps the
      // existing value when the incoming one is null.
      const [updated] = await tx
        .update(parties)
        .set({
          name: sql`coalesce(${parties.name}, ${input.name ?? null})`,
          email: sql`coalesce(${parties.email}, ${input.email ?? null})`,
          phone9: sql`coalesce(${parties.phone9}, ${p9})`,
          docType: sql`coalesce(${parties.docType}, ${input.docType ?? null})`,
          docNumber: sql`coalesce(${parties.docNumber}, ${doc})`,
          updatedAt: sql`now()`,
        })
        .where(and(eq(parties.id, existing.id), eq(parties.orgId, ctx.tenantId)))
        .returning();
      return updated;
    }

    const [created] = await tx
      .insert(parties)
      .values({
        orgId: ctx.tenantId,
        type: input.type ?? 'person',
        name: input.name ?? null,
        phone9: p9,
        email: input.email ?? null,
        docType: input.docType ?? null,
        docNumber: doc,
      })
      .returning();
    return created;
  });
}

// last-9-digits phone match (Peru). The cross-module BRIDGE (not the identity).
// Mirrors crm-finance.service's PHONE9 and the JS phone9() above.
const P9 = (col: string) => sql.raw(`right(regexp_replace(coalesce(${col},''),'\\D','','g'), 9)`);
// DNI/RUC pulled from a crm_contact's custom_fields (imported patients carry it).
// Canonical key is lowercase 'dni' (crm-cleanup); tolerate the 'DNI' variant.
const CRM_DOC = sql.raw(`nullif(trim(coalesce(c.custom_fields->>'dni', c.custom_fields->>'DNI')), '')`);
const FIN_DOC = sql.raw(`nullif(trim(fc.doc_number), '')`);

/**
 * Idempotent, set-based party reconcile for one org. THE engine behind both
 * ingest wiring and backfill.
 *
 * Identity model (doc-primary, phone-fallback): doc_number (DNI/RUC) is the
 * PERMANENT unique key, so parties are first minted/merged by document — from
 * fin_clients.doc_number AND crm_contacts.custom_fields->>'dni'. Records with no
 * document fall back to phone9 (only if that phone isn't already owned by a
 * doc-party). Facets then link doc-first, phone-second.
 *
 * ponytail ceiling: phone-fallback can mis-link a family member who shares a
 * doc-holder's number and has no doc of their own — the SAME risk the legacy
 * phone bridge already carries; doc-keyed records are strictly more correct.
 * Full entity-resolution (union-find across all shared keys) is the upgrade
 * path. Re-run safe (only fills nulls / re-points changed links).
 */
export async function reconcileParties(ctx: CoreCtx): Promise<void> {
  await withOrgCore(ctx, async (tx) => {
    const org = sql`current_setting('app.current_org_id', true)`;

    // 1a. Doc-keyed parties from finance (doc = the permanent identity).
    await tx.execute(sql`
      insert into parties (org_id, type, name, phone9, email, doc_type, doc_number)
      select ${org}, 'person', max(fc.name),
             (array_remove(array_agg(${P9('fc.phone')}) filter (where length(${P9('fc.phone')}) >= 8), null))[1],
             max(fc.email), max(fc.doc_type), ${FIN_DOC}
      from fin_clients fc
      where fc.org_id = ${org} and ${FIN_DOC} is not null
      group by ${FIN_DOC}
      on conflict (org_id, doc_number) where doc_number is not null do update set
        name = coalesce(parties.name, excluded.name),
        email = coalesce(parties.email, excluded.email),
        phone9 = coalesce(parties.phone9, excluded.phone9),
        doc_type = coalesce(parties.doc_type, excluded.doc_type),
        updated_at = now()
    `);

    // 1b. Doc-keyed parties from CRM contacts carrying a DNI in custom_fields.
    await tx.execute(sql`
      insert into parties (org_id, type, name, phone9, doc_type, doc_number)
      select ${org}, 'person', max(c.display_name),
             (array_remove(array_agg(${P9('ci.external_id')}) filter (where ci.channel = 'whatsapp' and length(${P9('ci.external_id')}) >= 8), null))[1],
             'DNI', ${CRM_DOC}
      from crm_contacts c
      left join crm_contact_identities ci on ci.contact_id = c.id
      where c.org_id = ${org} and ${CRM_DOC} is not null
      group by ${CRM_DOC}
      on conflict (org_id, doc_number) where doc_number is not null do update set
        name = coalesce(parties.name, excluded.name),
        phone9 = coalesce(parties.phone9, excluded.phone9),
        updated_at = now()
    `);

    // 2. Phone-keyed parties for doc-less records whose phone isn't already a
    //    party's phone. No phone9 unique → guard with NOT EXISTS for idempotency.
    await tx.execute(sql`
      insert into parties (org_id, type, name, phone9)
      select ${org}, 'person', max(name), p9 from (
        select ${P9('ci.external_id')} p9, c.display_name name
        from crm_contact_identities ci join crm_contacts c on c.id = ci.contact_id
        where ci.org_id = ${org} and ci.channel = 'whatsapp'
          and length(${P9('ci.external_id')}) >= 8 and ${CRM_DOC} is null
        union all
        select ${P9('fc.phone')}, fc.name from fin_clients fc
        where fc.org_id = ${org} and length(${P9('fc.phone')}) >= 8 and ${FIN_DOC} is null
      ) s
      where not exists (select 1 from parties p where p.org_id = ${org} and p.phone9 = s.p9)
      group by p9
    `);

    // 3. Link facets — document first, phone fallback for the still-unlinked.
    await tx.execute(sql`
      update fin_clients fc set party_id = p.id from parties p
      where fc.org_id = ${org} and p.org_id = ${org}
        and p.doc_number is not null and p.doc_number = ${FIN_DOC}
        and fc.party_id is distinct from p.id
    `);
    await tx.execute(sql`
      update fin_clients fc set party_id = p.id from parties p
      where fc.org_id = ${org} and p.org_id = ${org} and fc.party_id is null
        and length(${P9('fc.phone')}) >= 8 and p.phone9 = ${P9('fc.phone')}
    `);
    await tx.execute(sql`
      update crm_contacts c set party_id = p.id, updated_at = now() from parties p
      where c.org_id = ${org} and p.org_id = ${org}
        and p.doc_number is not null and p.doc_number = ${CRM_DOC}
        and c.party_id is distinct from p.id
    `);
    await tx.execute(sql`
      update crm_contacts c set party_id = p.id, updated_at = now()
      from parties p, crm_contact_identities ci
      where c.org_id = ${org} and ci.contact_id = c.id and ci.channel = 'whatsapp'
        and p.org_id = ${org} and length(${P9('ci.external_id')}) >= 8
        and p.phone9 = ${P9('ci.external_id')} and c.party_id is null
    `);
    await tx.execute(sql`
      update sched_bookings b set party_id = p.id, updated_at = now() from parties p
      where b.org_id = ${org} and p.org_id = ${org}
        and length(${P9('b.attendee_phone')}) >= 8 and p.phone9 = ${P9('b.attendee_phone')}
        and b.party_id is distinct from p.id
    `);
  });
}

export async function getParty(ctx: CoreCtx, id: string): Promise<Party | null> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(parties)
      .where(and(eq(parties.id, id), eq(parties.orgId, ctx.tenantId)))
      .limit(1);
    return row ?? null;
  });
}

export type PartySearchRow = {
  id: string;
  name: string | null;
  type: string;
  email: string | null;
  docNumber: string | null;
};

/**
 * Typeahead search across the party spine (name / email / doc / phone), org-scoped.
 * `types` narrows by nature (e.g. ['person','company'] for a customer picker,
 * ['person','agent'] for an assignee/lead picker). Capped — this powers a picker,
 * not a report.
 */
export async function searchParties(
  ctx: CoreCtx,
  q: string,
  opts: { types?: string[]; limit?: number } = {},
): Promise<PartySearchRow[]> {
  const term = q.trim();
  return withOrgCore(ctx, (tx) => {
    const conds = [eq(parties.orgId, ctx.tenantId)];
    if (opts.types?.length) conds.push(inArray(parties.type, opts.types));
    if (term) {
      const like = `%${term}%`;
      conds.push(
        sql`(${parties.name} ilike ${like} or ${parties.email} ilike ${like} or ${parties.docNumber} ilike ${like} or ${parties.phone9} like ${like})`,
      );
    }
    return tx
      .select({ id: parties.id, name: parties.name, type: parties.type, email: parties.email, docNumber: parties.docNumber })
      .from(parties)
      .where(and(...conds))
      .orderBy(asc(parties.name))
      .limit(Math.min(opts.limit ?? 20, 50));
  });
}

/** Point a CRM contact at a party (the contact's "billing/identity" spine). */
export async function linkContactParty(
  ctx: CoreCtx,
  contactId: string,
  partyId: string,
): Promise<void> {
  await withOrgCore(ctx, async (tx) => {
    await tx
      .update(crmContacts)
      .set({ partyId, updatedAt: sql`now()` })
      .where(and(eq(crmContacts.id, contactId), eq(crmContacts.orgId, ctx.tenantId)));
  });
}

/** Resolve (or create) the party for a CRM contact, then link it. Convenience
 *  for the harvest/UI path: a contact's WhatsApp number is its phone key. */
export async function ensurePartyForContact(
  ctx: CoreCtx,
  contactId: string,
  input: EnsurePartyInput,
): Promise<Party> {
  const party = await ensureParty(ctx, input);
  await linkContactParty(ctx, contactId, party.id);
  return party;
}
