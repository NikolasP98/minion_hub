import { sql } from 'drizzle-orm';
import type { CoreTx } from '$server/db/with-org-core';
import { crmContacts, crmContactIdentities } from '$server/db/pg-crm-schema';
import type { Attribution } from '$lib/doors/attribution';

/**
 * Shared CRM contact find-or-create for every public entry point (the booking
 * flow and spec 041's doors). Moved verbatim from
 * scheduling-bookings.service.ts so booking and form doors dedupe identically;
 * `source` and `firstTouch` are the only additions.
 */

/** Last-9-digit (Peru) phone normalizer, matching crm-finance.service. Kept
 *  private: party.service's exported `phone9` returns null under 8 digits,
 *  which is not byte-identical to this one. */
function phone9(raw: string): string {
  return raw.replace(/\D/g, '').slice(-9);
}

/** Resolve a CRM contact by phone (whatsapp identity) or email. Null if no match. */
export async function resolveCrmContact(
  tx: CoreTx,
  orgId: string,
  phone: string | null | undefined,
  email: string | null | undefined,
): Promise<string | null> {
  const p9 = phone ? phone9(phone) : '';
  const em = email ? email.trim().toLowerCase() : '';
  if (p9.length < 8 && !em) return null;
  try {
    const rows = (await tx.execute(sql`
      select contact_id from crm_contact_identities
      where org_id = ${orgId}
        and (
          (channel = 'whatsapp' and length(regexp_replace(coalesce(external_id,''),'\\D','','g')) >= 8
            and right(regexp_replace(coalesce(external_id,''),'\\D','','g'), 9) = ${p9} and ${p9} <> '')
          or (channel = 'email' and lower(external_id) = ${em} and ${em} <> '')
        )
      limit 1
    `)) as unknown as Array<{ contact_id: string }>;
    return rows.length ? rows[0].contact_id : null;
  } catch {
    // CRM tables absent / disabled — booking still succeeds without the bridge.
    return null;
  }
}

export interface EnsureCrmContactInput {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  /** `crm_contacts.source` on create: 'booking' | `door:${slug}`. */
  source: string;
  /** Written to `crm_contacts.first_touch` ONLY when this call creates the contact. */
  firstTouch?: Attribution | null;
}

/**
 * Resolve a CRM contact by phone/email, or CREATE one so every booker / door
 * visitor lands in the CRM. The resolve-first step is the dedup guard: an
 * existing customer is matched (last-9 phone or email) and reused, never
 * duplicated, and its `first_touch` is never overwritten. Identities are stored
 * E.164 (`+digits`) to match the ledger harvest's `external_id` shape so a
 * later WhatsApp message folds into the same contact via the unique
 * (org, channel, external_id) index.
 * ponytail: 9-digit local input (no country code) can still diverge from the
 * harvest's `+51…`; resolve's last-9 match keeps future bookings deduped, the
 * rare format-mismatch harvest dupe is the CRM cleanup tool's job.
 */
export async function ensureCrmContact(
  tx: CoreTx,
  orgId: string,
  input: EnsureCrmContactInput,
): Promise<{ id: string; created: boolean } | null> {
  const { name, phone, email, source, firstTouch } = input;
  const existing = await resolveCrmContact(tx, orgId, phone, email);
  if (existing) return { id: existing, created: false };
  const digits = phone ? phone.replace(/\D/g, '') : '';
  const em = email ? email.trim().toLowerCase() : '';
  if (digits.length < 8 && !em) return null; // nothing to identify them by
  try {
    const [c] = await tx
      .insert(crmContacts)
      .values({
        orgId,
        displayName: name?.trim() || null,
        source,
        ...(firstTouch ? { firstTouch } : {}),
      })
      .returning({ id: crmContacts.id });
    const identities: Array<typeof crmContactIdentities.$inferInsert> = [];
    if (digits.length >= 8)
      identities.push({
        orgId,
        contactId: c.id,
        channel: 'whatsapp',
        externalId: `+${digits}`,
        handle: name?.trim() || null,
      });
    if (em)
      identities.push({
        orgId,
        contactId: c.id,
        channel: 'email',
        externalId: em,
        handle: name?.trim() || null,
      });
    if (identities.length)
      await tx
        .insert(crmContactIdentities)
        .values(identities)
        .onConflictDoNothing({
          target: [
            crmContactIdentities.orgId,
            crmContactIdentities.channel,
            crmContactIdentities.externalId,
          ],
        });
    return { id: c.id, created: true };
  } catch {
    // TODO(handoff): catch inside tx aborts the tx — in Postgres a failed
    // statement aborts the surrounding transaction, so the caller's next
    // statement fails anyway; see proposal 2026-10-24-hub-collection-points-followups.
    // CRM tables absent / disabled — booking still succeeds without the bridge.
    return null;
  }
}
