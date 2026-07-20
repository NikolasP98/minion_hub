import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { invalidateTags, tags } from '@minion-stack/cache';
import { canonicalSex, dniNameMatches, formatRegistryName, lookupDni, parseDob } from '@minion-stack/crm-sdk';
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
// A document is a usable identity key only if it's a real DNI/RUC. Placeholder
// values — all-same-digit (e.g. '00000000') or too short (<8) — are NOT keys:
// SUSII defaults a missing DNI to '00000000', and keying on it collapsed every
// such payer into ONE party (229-invoice "Zoe Guillen" aggregate). Treat those
// as null so they fall through to phone, then to a per-record standalone party.
const cleanDoc = (col: string) =>
  sql.raw(
    `(case when nullif(trim(${col}),'') ~ '^(.)\\1*$' or length(nullif(trim(${col}),'')) < 8 then null else nullif(trim(${col}),'') end)`,
  );
// DNI/RUC pulled from a crm_contact's custom_fields (imported patients carry it).
// Canonical key is lowercase 'dni' (crm-cleanup); tolerate the 'DNI' variant.
const CRM_DOC = cleanDoc(`coalesce(c.custom_fields->>'dni', c.custom_fields->>'DNI')`);
const FIN_DOC = cleanDoc('fc.doc_number');

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

    // 3.5. Standalone party per fin_client that's STILL unlinked (no usable doc
    //      AND no phone — e.g. a placeholder-DNI walk-in). Each gets its OWN
    //      party so they stay distinct customers instead of collapsing together.
    //      Seeds phone9 when present so step 2 won't later mint a duplicate
    //      phone-party. Correlates new party → source fin_client via metadata.
    //      Idempotent: only fires for party_id IS NULL.
    await tx.execute(sql`
      with seed as (
        insert into parties (org_id, type, name, phone9, doc_type, metadata)
        select ${org}, 'person', fc.name,
               case when length(${P9('fc.phone')}) >= 8 then ${P9('fc.phone')} else null end,
               fc.doc_type,
               jsonb_build_object('seed_fin_client', fc.id)
        from fin_clients fc
        where fc.org_id = ${org} and fc.party_id is null
        returning id, (metadata->>'seed_fin_client')::uuid as fc_id
      )
      update fin_clients fc set party_id = seed.id
      from seed where fc.id = seed.fc_id and fc.org_id = ${org}
    `);

    // 4. Mint a CRM contact for every PAYER (a party with a fin_client facet) that
    //    has none yet — so all payers are tracked in the CRM and their invoices
    //    attribute to revenue via the party spine (crm-finance.service). Without
    //    this, finance-only payers (never messaged on WhatsApp) had a party but no
    //    contact, so ~60% of finance revenue sat outside the CRM. Idempotent
    //    (NOT EXISTS guard). Official billing name, casing normalized; DNI + phone
    //    carried into custom_fields so the contact carries basic identity.
    await tx.execute(sql`
      insert into crm_contacts (org_id, display_name, party_id, source, custom_fields)
      select ${org}, initcap(coalesce(max(fc.name), p.name)), p.id, 'finance',
             jsonb_strip_nulls(jsonb_build_object('dni', p.doc_number, 'phone', max(fc.phone)))
      from parties p
      join fin_clients fc on fc.org_id = ${org} and fc.party_id = p.id
      where p.org_id = ${org}
        and not exists (
          select 1 from crm_contacts c where c.org_id = ${org} and c.party_id = p.id
        )
      group by p.id, p.name, p.doc_number
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
  phone9: string | null;
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
      .select({ id: parties.id, name: parties.name, type: parties.type, email: parties.email, docNumber: parties.docNumber, phone9: parties.phone9 })
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

// ── DNI identity validation (PERUDEVS) ────────────────────────────────────────

/**
 * Manual override for the CRM customers-table verified checkmark.
 * Records manual:true in metadata.dni_validation so the tick never re-queries
 * a hand-set row. Returns false when the party doesn't exist in this org — or,
 * when turning verification ON, when it carries no 8-digit DNI to verify.
 */
export async function setPartyDniVerified(
  ctx: CoreCtx,
  partyId: string,
  verified: boolean,
): Promise<boolean> {
  const updated = await withOrgCore(ctx, async (tx) => {
    const rows = await tx
      .update(parties)
      .set({
        dniVerified: verified,
        metadata: sql`metadata || jsonb_build_object('dni_validation',
          coalesce(metadata->'dni_validation', '{}'::jsonb) ||
          jsonb_build_object('status', ${verified ? 'verified' : 'mismatch'}::text, 'manual', true))`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(parties.id, partyId),
          eq(parties.orgId, ctx.tenantId),
          // "Verified" MEANS "this document was checked against the registry", so
          // it is meaningless without a document. Turning it ON requires an
          // 8-digit DNI; turning it OFF is always allowed. Without this the
          // manual toggle can mint a verified party with no doc_number — exactly
          // the "verified but no DNI" rows that made the roster contradict itself.
          ...(verified ? [sql`${parties.docNumber} ~ '^[0-9]{8}$'`] : []),
        ),
      )
      .returning({ id: parties.id });
    return rows.length > 0;
  });
  // The customers roster caches dni_verified — bust so the toggle shows instantly.
  if (updated) await invalidateTags([...tags.tenantDomain(ctx.tenantId, 'crm')]);
  return updated;
}

/**
 * Validate pending 8-digit DNIs against the PERUDEVS registry (the ongoing
 * mechanism behind /api/crm/dni-validation/tick; the historical bulk was
 * backfilled 2026-07-15). verified → dni_verified=true + dob (age derives from
 * dob); mismatch/not_found/error are recorded in metadata.dni_validation so a
 * row is attempted once. Only parties whose doc_number is EXACTLY 8 digits are
 * ever claimed — anything else is not a DNI and would waste an API call.
 */
export async function validatePendingDnis(
  ctx: CoreCtx,
  apiKey: string,
  limit = 25,
): Promise<{ claimed: number; verified: number; mismatch: number; not_found: number; error: number }> {
  const claimed = (await withOrgCore(ctx, (tx) =>
    tx.execute(sql`
      update parties set
        metadata = metadata || '{"dni_validation":{"status":"processing"}}'::jsonb,
        updated_at = now()
      where id in (
        select id from parties
        where org_id = ${ctx.tenantId} and type = 'person'
          and doc_number ~ '^[0-9]{8}$'
          and dni_verified = false
          -- unattempted, OR stranded in 'processing' by a worker that died
          -- mid-batch >5min ago (reclaim so a crash never permanently parks a row)
          and (metadata->'dni_validation' is null
               or (metadata->'dni_validation'->>'status' = 'processing'
                   and updated_at < now() - interval '5 minutes'))
        limit ${limit}
        for update skip locked)
      returning id, name, doc_number`),
  )) as unknown as { id: string; name: string | null; doc_number: string }[];

  const counts = { verified: 0, mismatch: 0, not_found: 0, error: 0 };
  for (const row of claimed) {
    const result = await lookupDni(row.doc_number, apiKey);
    let status: keyof typeof counts;
    let dob: string | null = null;
    if (result.status === 'error') {
      status = 'error';
    } else if (result.status === 'not_found') {
      status = 'not_found';
    } else if (dniNameMatches(row.name ?? '', result.person)) {
      status = 'verified';
      dob = parseDob(result.person.fecha_nacimiento);
    } else {
      status = 'mismatch';
    }
    counts[status] += 1;
    await withOrgCore(ctx, (tx) =>
      tx.execute(sql`
        update parties set
          dni_verified = ${status === 'verified'},
          dob = coalesce(${dob}::date, dob),
          metadata = metadata || jsonb_build_object('dni_validation',
            jsonb_build_object('status', ${status}::text, 'checked_at', now(), 'api', 'perudevs')),
          updated_at = now()
        where id = ${row.id}`),
    );
    // Verified → enrich identity fields from the registry (official full name +
    // sex), so a newly-validated party carries the same data as the backfill.
    if (status === 'verified' && result.status === 'found') {
      await applyRegistryEnrichment(ctx, row.id, result.person);
    }
  }
  if (claimed.length > 0) await invalidateTags([...tags.tenantDomain(ctx.tenantId, 'crm')]);
  return { claimed: claimed.length, ...counts };
}

/**
 * Write registry identity data onto a verified party AND its linked CRM
 * contact(s): overwrite the canonical name with the registry parts, and stash
 * the raw payload (incl. genero M/F → sex, verification code) in
 * metadata.dni_registry — the audit trail + the source the list reads sex from,
 * and it lets a re-run skip a second API call. Name is coalesced so an empty
 * registry name never blanks an existing one. Sex stays canonical M/F in the DB;
 * localization to Hombre/Mujer happens in the UI.
 */
export async function applyRegistryEnrichment(
  ctx: CoreCtx,
  partyId: string,
  person: {
    nombres: string;
    apellido_paterno: string;
    apellido_materno: string;
    nombre_completo: string;
    genero: string;
    codigo_verificacion: string;
  },
): Promise<void> {
  const name = formatRegistryName(person);
  const registry = {
    nombres: person.nombres,
    apellido_paterno: person.apellido_paterno,
    apellido_materno: person.apellido_materno,
    nombre_completo: person.nombre_completo,
    sex: canonicalSex(person.genero),
    codigo_verificacion: person.codigo_verificacion,
    captured_at: new Date().toISOString(),
  };
  const registryJson = JSON.stringify(registry);
  await withOrgCore(ctx, async (tx) => {
    await tx.execute(sql`
      update parties set
        name = coalesce(${name}, name),
        metadata = metadata || jsonb_build_object('dni_registry', ${registryJson}::jsonb),
        updated_at = now()
      where id = ${partyId} and org_id = ${ctx.tenantId}`);
    // The CRM customers table renders display_name, so the name overwrite must
    // land there too, not only on the spine. Sex is read live from the party's
    // dni_registry (canonical M/F, localized in the UI) — not written to the
    // legacy Spanish custom_fields.sexo.
    await tx.execute(sql`
      update crm_contacts set
        display_name = coalesce(${name}, display_name),
        updated_at = now()
      where party_id = ${partyId} and org_id = ${ctx.tenantId} and deleted_at is null`);
  });
}

/**
 * Re-query the registry for already-verified parties that predate identity
 * enrichment (metadata.dni_registry absent) and fill in name/sex/payload.
 * One-shot backfill companion to validatePendingDnis; safe to re-run.
 */
export async function reenrichVerifiedDnis(
  ctx: CoreCtx,
  apiKey: string,
  limit = 25,
): Promise<{ scanned: number; enriched: number; gone: number; error: number }> {
  const rows = (await withOrgCore(ctx, (tx) =>
    tx.execute(sql`
      select id, doc_number from parties
      where org_id = ${ctx.tenantId} and type = 'person'
        and dni_verified = true
        and doc_number ~ '^[0-9]{8}$'
        and metadata->'dni_registry' is null
      limit ${limit}`),
  )) as unknown as { id: string; doc_number: string }[];

  let enriched = 0;
  let gone = 0;
  let error = 0;
  for (const row of rows) {
    const result = await lookupDni(row.doc_number, apiKey);
    if (result.status === 'found') {
      await applyRegistryEnrichment(ctx, row.id, result.person);
      enriched += 1;
    } else if (result.status === 'not_found') {
      gone += 1; // verified earlier but registry no longer returns it — leave as-is
    } else {
      error += 1;
    }
  }
  if (enriched > 0) await invalidateTags([...tags.tenantDomain(ctx.tenantId, 'crm')]);
  return { scanned: rows.length, enriched, gone, error };
}
