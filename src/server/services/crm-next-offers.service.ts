import { sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';

export interface BoughtProduct {
  productId: string;
  name: string;
  qty: number;
  lastAt: string | null;
}
export interface OfferSuggestion {
  productId: string;
  name: string;
  category: string | null;
  unitPrice: number | null;
  /** Other customers who bought this together with what the contact bought. */
  coBuyers: number;
}
export interface NextOffers {
  bought: BoughtProduct[];
  suggestions: OfferSuggestion[];
  /** Filled only when the contact has no purchase history (last 90 days, org-wide). */
  topSellers: OfferSuggestion[];
}

const MAX_SUGGESTIONS = 5;

/** FR-008 order: co-buyers desc, then non-negative price step-up ascending, then the rest. */
export function rankOffers(candidates: OfferSuggestion[], refPrice: number): OfferSuggestion[] {
  const price = (c: OfferSuggestion) => c.unitPrice ?? Number.POSITIVE_INFINITY;
  const stepUp = (c: OfferSuggestion) => c.unitPrice != null && c.unitPrice >= refPrice;
  return [...candidates]
    .sort(
      (a, b) =>
        b.coBuyers - a.coBuyers ||
        Number(stepUp(b)) - Number(stepUp(a)) ||
        price(a) - price(b) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, MAX_SUGGESTIONS);
}

type OfferRow = {
  id: string;
  name: string;
  category: string | null;
  unit_price: string | null;
  buyers: string | number;
};
const toSuggestion = (r: OfferRow): OfferSuggestion => ({
  productId: r.id,
  name: r.name,
  category: r.category,
  unitPrice: r.unit_price == null ? null : Number(r.unit_price),
  coBuyers: Number(r.buyers),
});

/**
 * Read-only: what a contact bought (submitted POS tickets only; voids and
 * non-catalog lines excluded) and what to offer next. Customer identity of a
 * ticket = party_id, else crm_contact_id.
 */
export async function getNextOffers(ctx: CoreCtx, contactId: string): Promise<NextOffers> {
  return withOrgCore(ctx, async (tx) => {
    const [contact] = (await tx.execute(
      sql`select party_id::text as party_id from crm_contacts
          where id = ${contactId} and org_id = current_setting('app.current_org_id', true)`,
    )) as unknown as Array<{ party_id: string | null }>;
    const partyId = contact?.party_id ?? null;
    // Tickets belonging to this contact, by id or by party.
    const mine = sql`(t.crm_contact_id = ${contactId} or (${partyId}::uuid is not null and t.party_id = ${partyId}::uuid))`;

    const boughtRows = (await tx.execute(sql`
      select l.fin_product_id::text as id, coalesce(p.name, max(l.description)) as name,
             sum(l.qty) as qty, max(t.submitted_at) as last_at, max(p.unit_price) as unit_price
      from pos_tickets t
      join pos_ticket_lines l on l.ticket_id = t.id and l.org_id = t.org_id
      left join fin_products p on p.id = l.fin_product_id
      where t.org_id = current_setting('app.current_org_id', true)
        and t.status = 'submitted' and l.fin_product_id is not null and ${mine}
      group by l.fin_product_id, p.name
      order by max(t.submitted_at) desc
    `)) as unknown as Array<{
      id: string;
      name: string;
      qty: string;
      last_at: Date | string | null;
      unit_price: string | null;
    }>;

    if (boughtRows.length === 0) {
      const top = (await tx.execute(sql`
        select p.id::text as id, p.name, p.category, p.unit_price, count(distinct t.id) as buyers
        from pos_tickets t
        join pos_ticket_lines l on l.ticket_id = t.id and l.org_id = t.org_id
        join fin_products p on p.id = l.fin_product_id and p.active
        where t.org_id = current_setting('app.current_org_id', true)
          and t.status = 'submitted' and t.submitted_at > now() - interval '90 days'
        group by p.id order by count(distinct t.id) desc, p.name limit ${MAX_SUGGESTIONS}
      `)) as unknown as OfferRow[];
      return { bought: [], suggestions: [], topSellers: top.map(toSuggestion) };
    }

    // Every active product the contact has not bought, with how many OTHER
    // customers bought it alongside something the contact bought.
    const candidates = (await tx.execute(sql`
      with mine as (select unnest(array[${sql.join(
        boughtRows.map((b) => sql`${b.id}::uuid`),
        sql`, `,
      )}]::uuid[]) as pid),
      co as (
        select distinct coalesce(t.party_id::text, t.crm_contact_id::text) as who
        from pos_tickets t
        join pos_ticket_lines l on l.ticket_id = t.id and l.org_id = t.org_id
        where t.org_id = current_setting('app.current_org_id', true)
          and t.status = 'submitted' and l.fin_product_id in (select pid from mine)
          and coalesce(t.party_id::text, t.crm_contact_id::text) is not null
          -- "is not true", not "not": a NULL party or contact column made it NULL and dropped the buyer.
          and ${mine} is not true
      )
      select p.id::text as id, p.name, p.category, p.unit_price,
        (select count(distinct coalesce(t.party_id::text, t.crm_contact_id::text))
           from pos_tickets t join pos_ticket_lines l on l.ticket_id = t.id and l.org_id = t.org_id
          where t.org_id = p.org_id and t.status = 'submitted' and l.fin_product_id = p.id
            and coalesce(t.party_id::text, t.crm_contact_id::text) in (select who from co)) as buyers
      from fin_products p
      where p.org_id = current_setting('app.current_org_id', true) and p.active
        and p.id not in (select pid from mine)
      order by buyers desc, p.unit_price asc nulls last limit 200
    `)) as unknown as OfferRow[];

    const refPrice = Math.max(0, ...boughtRows.map((b) => Number(b.unit_price ?? 0)));
    return {
      bought: boughtRows.map((b) => ({
        productId: b.id,
        name: b.name,
        qty: Number(b.qty),
        lastAt: b.last_at ? new Date(b.last_at).toISOString() : null,
      })),
      suggestions: rankOffers(candidates.map(toSuggestion), refPrice),
      topSellers: [],
    };
  });
}
