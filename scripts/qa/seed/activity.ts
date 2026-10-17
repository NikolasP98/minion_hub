/**
 * Activity — the last 90 days of plausible business volume for the QA
 * Business Org (spec 015): bookings, POS shifts/tickets/lines/payments,
 * clients/invoices. The permutation modules prove STATES; this one gives
 * time-based views (heatmaps, trends, "last 30 days") something to show.
 *
 * Every row is a pure function of (calendar day, fixed seed): a per-day
 * mulberry32 means a past day never changes between runs or across days —
 * only the window slides. Idempotency is delete-then-insert of the `ACT-`
 * tagged set (the README's alternative to ON CONFLICT when a set's
 * cardinality depends on the run date).
 */
import { createHash } from 'node:crypto';
import { matrixUuid } from './ids';
import { ORG_BUSINESS, userId } from './tenancy';
import {
  PRODUCT_SERVICE_PLAIN,
  PRODUCT_BUNDLE_CHILD_A,
  PRODUCT_BUNDLE_CHILD_B,
  PRODUCT_CONSUMPTION_2_ITEMS,
  PRODUCT_TRACKED,
  PRODUCT_RAW_MATERIAL_LINK,
} from './catalog';
import {
  CONTACT_DNI_VERIFIED,
  CONTACT_FUNNEL_CUSTOMER,
  CONTACT_FUNNEL_LOYAL,
  CONTACT_FUNNEL_OPPORTUNITY,
  CONTACT_REL_USER_PINNED,
  CONTACT_ACTIVITY_PRESENT,
} from './crm';
import {
  EVENT_TYPE_PLAIN,
  EVENT_TYPE_LINKED,
  EVENT_TYPE_CONFIRMATION,
  RESOURCE_LIMA,
  RESOURCE_MADRID,
  KIND_DEFAULT,
} from './scheduling';
import type { SeedContext } from './db';

export const ACTIVITY_DAYS = 90;
/** Peru has no DST, so a fixed offset is exact. */
const LIMA = '-05:00';
const LIMA_OFFSET_MS = 5 * 60 * 60 * 1000;

/** Catalog rows this module sells; prices mirror catalog.ts (one source of truth: the id). */
const PRODUCTS = [
  { id: PRODUCT_SERVICE_PLAIN, kind: 'service', name: 'QA Plain Service', price: 80 },
  { id: PRODUCT_BUNDLE_CHILD_A, kind: 'service', name: 'QA Bundle Child A', price: 80 },
  { id: PRODUCT_BUNDLE_CHILD_B, kind: 'service', name: 'QA Bundle Child B', price: 70 },
  { id: PRODUCT_CONSUMPTION_2_ITEMS, kind: 'service', name: 'QA Consumption Product', price: 55 },
  { id: PRODUCT_TRACKED, kind: 'product', name: 'QA Tracked Product', price: 35 },
  {
    id: PRODUCT_RAW_MATERIAL_LINK,
    kind: 'product',
    name: 'QA Raw-Material-Linked Product',
    price: 20,
  },
] as const;

const CONTACTS = [
  { id: CONTACT_DNI_VERIFIED, name: 'QA DNI Verified' },
  { id: CONTACT_FUNNEL_CUSTOMER, name: 'QA Funnel Customer' },
  { id: CONTACT_FUNNEL_LOYAL, name: 'QA Funnel Loyal' },
  { id: CONTACT_FUNNEL_OPPORTUNITY, name: 'QA Funnel Opportunity' },
  { id: CONTACT_REL_USER_PINNED, name: 'QA Relationship User-Pinned' },
  { id: CONTACT_ACTIVITY_PRESENT, name: 'QA Busy Contact 名前 🙂' },
] as const;

const CLIENTS = [
  ['Clínica Belleza Total SAC', 'RUC', '20601234561'],
  ['María Torres Quispe', 'DNI', '45678901'],
  ['Estética Luz SAC', 'RUC', '20512345678'],
  ['José Ramírez Paredes', 'DNI', '41234567'],
  ['Spa Andino EIRL', 'RUC', '20498765432'],
  ['Ana Lucía Mendoza', 'DNI', '72345678'],
  ['Dermacenter Perú SAC', 'RUC', '20556677889'],
  ['Carlos Huamán Vega', 'DNI', '09876543'],
] as const;

/** Lima hour → relative weight (late morning and early evening peaks). */
const HOUR_WEIGHTS: ReadonlyArray<readonly [number, number]> = [
  [9, 2],
  [10, 3],
  [11, 4],
  [12, 3],
  [13, 2],
  [14, 1],
  [15, 2],
  [16, 3],
  [17, 4],
  [18, 4],
  [19, 2],
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function daySeed(day: string): number {
  return createHash('sha1').update(`qa-activity:${day}`).digest().readUInt32BE(0);
}

function weighted<T>(rng: () => number, items: ReadonlyArray<readonly [T, number]>): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [item, w] of items) {
    r -= w;
    if (r < 0) return item;
  }
  return items[items.length - 1]![0];
}

function pick<T>(rng: () => number, items: ReadonlyArray<T>): T {
  return items[Math.floor(rng() * items.length)]!;
}

function limaDate(day: string, hour: number, minute = 0): Date {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return new Date(`${day}T${hh}:${mm}:00${LIMA}`);
}

export interface ActivityRows {
  bookings: Array<Record<string, unknown>>;
  shifts: Array<Record<string, unknown>>;
  tickets: Array<Record<string, unknown>>;
  lines: Array<Record<string, unknown>>;
  payments: Array<Record<string, unknown>>;
  clients: Array<Record<string, unknown>>;
  invoices: Array<Record<string, unknown>>;
  items: Array<Record<string, unknown>>;
}

/** Pure: the whole generated set for the `ACTIVITY_DAYS` Lima calendar days before `now`. */
export function generateActivity(now: Date): ActivityRows {
  const owner = userId('tenancy.user.owner');
  const out: ActivityRows = {
    bookings: [],
    shifts: [],
    tickets: [],
    lines: [],
    payments: [],
    clients: [],
    invoices: [],
    items: [],
  };

  out.clients = CLIENTS.map(([name, docType, docNumber], n) => ({
    id: matrixUuid('activity.client', String(n)),
    org_id: ORG_BUSINESS,
    provider: 'susii',
    provider_ref: `ACT-CLI-${n}`,
    name,
    doc_type: docType,
    doc_number: docNumber,
  }));

  const todayLima = new Date(now.getTime() - LIMA_OFFSET_MS);
  let invoiceSeq = 0;
  for (let k = ACTIVITY_DAYS; k >= 1; k -= 1) {
    const d = new Date(todayLima.getTime() - k * 24 * 60 * 60 * 1000);
    const day = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    if (dow === 0) continue; // closed on Sundays
    const rng = mulberry32(daySeed(day));

    // ── Bookings ──
    const bookingCount = dow === 6 ? 1 + Math.floor(rng() * 3) : 1 + Math.floor(rng() * 4);
    for (let i = 0; i < bookingCount; i += 1) {
      const start = limaDate(day, weighted(rng, HOUR_WEIGHTS), rng() < 0.5 ? 0 : 30);
      const end = new Date(start.getTime() + pick(rng, [30, 45, 60]) * 60 * 1000);
      const contact = pick(rng, CONTACTS);
      const product = pick(
        rng,
        PRODUCTS.filter((p) => p.kind === 'service'),
      );
      const uid = `ACT-BK-${day}-${i}`;
      out.bookings.push({
        id: matrixUuid('activity.booking', `${day}:${i}`),
        org_id: ORG_BUSINESS,
        uid,
        event_type_id: pick(rng, [
          EVENT_TYPE_PLAIN,
          EVENT_TYPE_PLAIN,
          EVENT_TYPE_LINKED,
          EVENT_TYPE_CONFIRMATION,
        ]),
        resource_id: rng() < 0.8 ? RESOURCE_LIMA : RESOURCE_MADRID,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        status: weighted(rng, [
          ['completed', 70],
          ['accepted', 12],
          ['cancelled', 12],
          ['no_show', 6],
        ]),
        title: product.name,
        attendee_name: contact.name,
        crm_contact_id: contact.id,
        product_id: product.id,
        kind_id: KIND_DEFAULT,
        source: rng() < 0.3 ? 'public_link' : 'internal',
      });
    }

    // ── POS: one closed shift per selling day, 0–3 tickets ──
    const ticketCount = pick(rng, [0, 1, 1, 2, 2, 3]);
    if (ticketCount > 0) {
      const shiftId = matrixUuid('activity.shift', day);
      const byMethod: Record<string, number> = {};
      for (let i = 0; i < ticketCount; i += 1) {
        const ticketId = matrixUuid('activity.ticket', `${day}:${i}`);
        const lineCount = 1 + Math.floor(rng() * 3);
        let total = 0;
        for (let l = 0; l < lineCount; l += 1) {
          const product = pick(rng, PRODUCTS);
          const qty = product.kind === 'product' && rng() < 0.4 ? 2 : 1;
          const lineTotal = qty * product.price;
          total += lineTotal;
          out.lines.push({
            id: matrixUuid('activity.ticket', `${day}:${i}:line-${l}`),
            org_id: ORG_BUSINESS,
            ticket_id: ticketId,
            kind: product.kind,
            fin_product_id: product.id,
            description: product.name,
            qty,
            unit_price: product.price,
            total: lineTotal,
            line_no: l,
          });
        }
        const submittedAt = limaDate(day, weighted(rng, HOUR_WEIGHTS), Math.floor(rng() * 60));
        const voided = rng() < 0.05;
        const method = weighted(rng, [
          ['cash', 50],
          ['card', 30],
          ['yape', 20],
        ]);
        const contact = pick(rng, CONTACTS);
        out.tickets.push({
          id: ticketId,
          org_id: ORG_BUSINESS,
          human_id: `ACT-TKT-${day}-${i}`,
          shift_id: shiftId,
          crm_contact_id: contact.id,
          customer_name: contact.name,
          status: voided ? 'voided' : 'submitted',
          subtotal: total,
          total,
          created_by: owner,
          submitted_at: submittedAt.toISOString(),
          voided_at: voided ? new Date(submittedAt.getTime() + 10 * 60 * 1000).toISOString() : null,
          voided_by: voided ? owner : null,
        });
        out.payments.push({
          id: matrixUuid('activity.ticket', `${day}:${i}:pay`),
          org_id: ORG_BUSINESS,
          ticket_id: ticketId,
          shift_id: shiftId,
          method,
          amount: total,
          // shortcut: card surcharge (pos_settings 3.5%) not applied, upgrade if a report asserts it
          tendered:
            method === 'cash' ? Math.ceil(total / 10) * 10 : method === 'card' ? total : null,
          paid_at: submittedAt.toISOString(),
        });
        if (!voided) byMethod[method] = (byMethod[method] ?? 0) + total;
      }
      out.shifts.push({
        id: shiftId,
        org_id: ORG_BUSINESS,
        status: 'closed',
        opened_by: owner,
        opened_at: limaDate(day, 8, 30).toISOString(),
        opening_float: JSON.stringify({ cash: 200 }),
        closed_by: owner,
        closed_at: limaDate(day, 20, 30).toISOString(),
        expected: JSON.stringify(byMethod),
        counted: JSON.stringify(byMethod),
        note: 'ACT-shift',
      });
    }

    // ── Invoices: roughly every other day ──
    if (rng() < 0.62) {
      invoiceSeq += 1;
      const invoiceId = matrixUuid('activity.invoice', day);
      const client = out.clients[Math.floor(rng() * out.clients.length)]!;
      const itemCount = 1 + Math.floor(rng() * 3);
      let subtotal = 0;
      for (let l = 0; l < itemCount; l += 1) {
        const product = pick(rng, PRODUCTS);
        const quantity = 1 + Math.floor(rng() * 3);
        const lineTotal = quantity * product.price;
        subtotal += lineTotal;
        out.items.push({
          id: matrixUuid('activity.invoice', `${day}:item-${l}`),
          org_id: ORG_BUSINESS,
          invoice_id: invoiceId,
          code: product.name,
          description: product.name,
          quantity,
          unit_price: product.price,
          total: lineTotal,
          product_id: product.id,
        });
      }
      const tax = Math.round(subtotal * 18) / 100;
      out.invoices.push({
        id: invoiceId,
        org_id: ORG_BUSINESS,
        provider: 'susii',
        provider_ref: `ACT-INV-${day}`,
        number: `F001-${String(invoiceSeq).padStart(5, '0')}`,
        issued_at: limaDate(day, weighted(rng, HOUR_WEIGHTS)).toISOString(),
        client_id: client.id,
        client_name: client.name,
        client_doc_type: client.doc_type,
        client_doc_number: client.doc_number,
        currency: 'PEN',
        subtotal,
        tax,
        total: subtotal + tax,
        status: weighted(rng, [
          ['paid', 75],
          ['pending', 15],
          ['void', 10],
        ]),
      });
    }
  }
  return out;
}

export async function seed(ctx: SeedContext): Promise<void> {
  const { sql, register, now } = ctx;
  const rows = generateActivity(now);

  // Delete the tagged set first (lines/payments/items cascade from their parents; tickets before shifts).
  await sql`delete from pos_tickets where org_id = ${ORG_BUSINESS} and human_id like 'ACT-TKT-%'`;
  await sql`delete from pos_shifts where org_id = ${ORG_BUSINESS} and note = 'ACT-shift'`;
  await sql`delete from fin_invoices where org_id = ${ORG_BUSINESS} and provider_ref like 'ACT-INV-%'`;
  await sql`delete from fin_clients where org_id = ${ORG_BUSINESS} and provider_ref like 'ACT-CLI-%'`;
  await sql`delete from sched_bookings where org_id = ${ORG_BUSINESS} and uid like 'ACT-BK-%'`;

  await sql`insert into sched_bookings ${sql(rows.bookings)}`;
  await sql`insert into pos_shifts ${sql(rows.shifts)}`;
  await sql`insert into pos_tickets ${sql(rows.tickets)}`;
  await sql`insert into pos_ticket_lines ${sql(rows.lines)}`;
  await sql`insert into pos_payments ${sql(rows.payments)}`;
  await sql`insert into fin_clients ${sql(rows.clients)}`;
  await sql`insert into fin_invoices ${sql(rows.invoices)}`;
  await sql`insert into fin_invoice_items ${sql(rows.items)}`;

  register('activity.bookings.90d', {
    table: 'sched_bookings',
    where: { id: rows.bookings[0]!.id as string },
  });
  register('activity.tickets.90d', {
    table: 'pos_tickets',
    where: { id: rows.tickets[0]!.id as string },
  });
  register('activity.invoices.90d', {
    table: 'fin_invoices',
    where: { id: rows.invoices[0]!.id as string },
  });
  console.log(
    `[qa:seed] activity: ${rows.bookings.length} bookings, ${rows.shifts.length} shifts, ${rows.tickets.length} tickets, ${rows.invoices.length} invoices`,
  );
}
