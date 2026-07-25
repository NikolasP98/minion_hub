import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { posSettings, posTickets, posTicketLines, posPayments, posShifts } from './pg-pos-schema';

/**
 * Column-set guards for the POS tables.
 *
 * ★ Why this exists: a Drizzle column with NO matching DB column is invisible to
 * `bun run check` — the schema is internally consistent, so types pass — but
 * Drizzle's bare `.select()` emits an EXPLICIT column list, so every read of
 * that table 500s at runtime with `column "x" does not exist`.
 *
 * That shipped on 2026-07-25: a search/replace added `surcharges` to
 * `pos_settings` AND (unintentionally, both tables share a
 * `currency: text('currency')...` line) to `pos_tickets`, whose migration never
 * created it. Result: every /pos/sell load 500'd via listTickets.
 *
 * Hardcoded expectations, in the same spirit as the route-contract test: adding
 * a column here is a deliberate act that must come WITH its migration.
 */
const cols = (t: Parameters<typeof getTableColumns>[0]) =>
  Object.values(getTableColumns(t))
    .map((c) => (c as { name: string }).name)
    .sort();

describe('pos schema column sets match their migrations', () => {
  it('pos_settings owns `surcharges` (20260725130000)', () => {
    expect(cols(posSettings)).toEqual(
      [
        'org_id', 'methods', 'currency', 'surcharges',
        'require_customer', 'allow_price_override', 'created_at', 'updated_at',
      ].sort(),
    );
  });

  it('pos_tickets does NOT own `surcharges` — a fee is settings, not a ticket column', () => {
    const c = cols(posTickets);
    expect(c).not.toContain('surcharges');
    expect(c).toEqual(
      [
        'id', 'org_id', 'human_id', 'shift_id', 'party_id', 'crm_contact_id',
        'customer_name', 'status', 'subtotal', 'discount', 'total', 'currency',
        'note', 'stock_entry_id', 'stock_warning', 'invoice_provider_ref',
        'created_by', 'submitted_at', 'voided_at', 'voided_by', 'metadata',
      ].sort(),
    );
  });

  it('the other POS tables were not collaterally edited', () => {
    expect(cols(posTicketLines)).toContain('modifiers');
    expect(cols(posTicketLines)).not.toContain('surcharges');
    expect(cols(posPayments)).not.toContain('surcharges');
    expect(cols(posShifts)).not.toContain('surcharges');
  });
});
