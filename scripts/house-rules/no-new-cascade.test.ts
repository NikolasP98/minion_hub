import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Spec 138 H3: sales/stock documents are never deleted, so nothing may cascade a delete onto them.
const FLOOR = '20261120130000';
const PROTECTED = ['pos_tickets', 'fin_invoices', 'stk_entries', 'fin_purchases', 'stk_ledger'];
const migrationsUrl = new URL('../../supabase/migrations/', import.meta.url);

/** Statements that reference a protected table as an FK target and cascade deletes onto it. */
export function cascadeViolations(sql: string): string[] {
  const text = sql.replace(/--[^\n]*/g, '').toLowerCase();
  const target = new RegExp(
    `\\breferences\\s+(?:"?public"?\\.)?"?(?:${PROTECTED.join('|')})"?(?![\\w])`,
  );
  return text
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => target.test(s) && /\bon delete cascade\b/.test(s));
}

describe('no new ON DELETE CASCADE onto document tables', () => {
  it('rejects a synthetic migration that cascades onto a protected table (D9)', () => {
    const bad = `create table public.x (id uuid, t uuid references public.pos_tickets(id)
      ON  DELETE
      CASCADE);`;
    expect(cascadeViolations(bad)).toHaveLength(1);
  });

  it('accepts RESTRICT and cascades onto other tables', () => {
    const ok = `create table public.x (a uuid references public.pos_tickets(id) on delete restrict);
      create table public.y (b uuid references public.other(id) on delete cascade);`;
    expect(cascadeViolations(ok)).toEqual([]);
  });

  it('no migration after the H3 revoke adds one', () => {
    const later = readdirSync(migrationsUrl)
      .filter((f) => f.endsWith('.sql') && f.split('_')[0] > FLOOR)
      .sort();
    for (const file of later) {
      const v = cascadeViolations(readFileSync(new URL(file, migrationsUrl), 'utf8'));
      expect(
        v,
        `${file}: ON DELETE CASCADE onto ${PROTECTED.join('/')} is forbidden (spec 138 H3). Use ON DELETE RESTRICT, and cancel or void the document instead of deleting it.`,
      ).toEqual([]);
    }
  });
});
