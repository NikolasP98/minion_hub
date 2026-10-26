import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as pgSchema from '@minion-stack/db/pg';
import { afterAll, describe, expect, it } from 'vitest';
import { testDatabaseUrl } from '$server/test-utils/test-db-url';
import { getNextOffers } from './crm-next-offers.service';

/**
 * The next-offers SQL (spec 041 S3) against the real QA schema, through the real
 * `withOrgCore` (app_ledger role + org GUC, forced RLS). Fixtures live under a
 * random org id and are deleted in `finally`.
 */
const databaseUrl = testDatabaseUrl();
const admin = databaseUrl ? postgres(databaseUrl, { max: 2, prepare: false }) : null;
const appClient = databaseUrl ? postgres(databaseUrl, { max: 1, prepare: false }) : null;
const appDb = appClient ? drizzle(appClient, { schema: pgSchema }) : null;

describe.runIf(Boolean(databaseUrl))('next offers native SQL', () => {
  afterAll(async () => {
    await Promise.all([admin?.end(), appClient?.end()]);
  });

  it('ranks co-bought products, skips owned, inactive, voided and foreign rows, and counts party tickets', async () => {
    const org = `f2-offers-${randomUUID()}`;
    const foreign = `f2-offers-x-${randomUUID()}`;
    const [me, y, z, w, fresh] = Array.from({ length: 5 }, () => randomUUID());
    const party = randomUUID();
    const p = Object.fromEntries(
      ['base', 'pair', 'cheap', 'retired', 'never', 'voided'].map((k) => [k, randomUUID()]),
    );
    const foreignProduct = randomUUID();
    const shift = randomUUID();
    const foreignShift = randomUUID();
    const ctx = { tenantId: org, db: appDb! as never };
    try {
      await admin!`insert into crm_contacts (id, org_id, source, party_id) values
        (${me}, ${org}, 'test', ${party}), (${y}, ${org}, 'test', null), (${z}, ${org}, 'test', null),
        (${w}, ${org}, 'test', null), (${fresh}, ${org}, 'test', null)`;
      await admin!`insert into fin_products (id, org_id, code, name, unit_price, active) values
        (${p.base}, ${org}, 'BASE', 'Base', 100, true),
        (${p.pair}, ${org}, 'PAIR', 'Pareja', 200, true),
        (${p.cheap}, ${org}, 'CHEAP', 'Barato', 50, true),
        (${p.retired}, ${org}, 'RET', 'Retirado', 300, false),
        (${p.never}, ${org}, 'NEVER', 'Nunca', 10, true),
        (${p.voided}, ${org}, 'VOID', 'Anulado', 500, true),
        (${foreignProduct}, ${foreign}, 'FOR', 'Ajeno', 1, true)`;
      await admin!`insert into pos_shifts (id, org_id) values (${shift}, ${org}), (${foreignShift}, ${foreign})`;

      // [ticket owner (contact or party), status, products]
      const tickets: Array<[{ contact?: string; party?: string }, string, string[], string?]> = [
        [{ party }, 'submitted', [p.base]], // mine, through the party only
        [{ contact: y }, 'submitted', [p.base, p.pair, p.retired]],
        [{ contact: z }, 'submitted', [p.base, p.pair]],
        [{ contact: w }, 'submitted', [p.base, p.cheap]],
        [{ contact: y }, 'voided', [p.base, p.voided]], // voids never count
        [{ contact: z }, 'submitted', [foreignProduct], foreign],
      ];
      for (const [who, status, products, owner = org] of tickets) {
        const id = randomUUID();
        await admin!`insert into pos_tickets (id, org_id, shift_id, status, subtotal, total, crm_contact_id, party_id)
          values (${id}, ${owner}, ${owner === org ? shift : foreignShift}, ${status}, 0, 0,
                  ${who.contact ?? null}, ${who.party ?? null})`;
        for (const [n, pid] of products.entries())
          await admin!`insert into pos_ticket_lines (org_id, ticket_id, kind, description, qty, unit_price, total, line_no, fin_product_id)
            values (${owner}, ${id}, 'product', 'x', 1, 0, 0, ${n}, ${pid})`;
      }

      const offers = await getNextOffers(ctx, me);
      expect(offers.bought.map((b) => [b.productId, b.qty])).toEqual([[p.base, 1]]);
      expect(offers.topSellers).toEqual([]);
      expect(offers.suggestions.map((s) => [s.name, s.coBuyers, s.unitPrice])).toEqual([
        ['Pareja', 2, 200],
        ['Barato', 1, 50],
        ['Anulado', 0, 500],
        ['Nunca', 0, 10],
      ]);

      // No purchase history → org-wide top sellers of the last 90 days, active only.
      const cold = await getNextOffers(ctx, fresh);
      expect(cold.bought).toEqual([]);
      expect(cold.topSellers.map((s) => [s.name, s.coBuyers])).toEqual([
        ['Base', 4],
        ['Pareja', 2],
        ['Barato', 1],
      ]);
    } finally {
      for (const o of [org, foreign]) {
        await admin!`delete from pos_ticket_lines where org_id = ${o}`;
        await admin!`delete from pos_tickets where org_id = ${o}`;
        await admin!`delete from pos_shifts where org_id = ${o}`;
        await admin!`delete from fin_products where org_id = ${o}`;
        await admin!`delete from crm_contacts where org_id = ${o}`;
      }
    }
  });
});
