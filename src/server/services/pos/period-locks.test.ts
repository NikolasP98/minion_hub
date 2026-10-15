import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { posTickets } from '$server/db/pg-pos-schema';
import { PosError } from './errors';
import { normalizePeriod, periodLockExists } from './period-locks';

const dialect = new PgDialect();
const render = (q: Parameters<PgDialect['sqlToQuery']>[0]) => dialect.sqlToQuery(q);

describe('normalizePeriod', () => {
  it('accepts a calendar month and nothing looser', () => {
    expect(normalizePeriod(' 2026-09 ')).toBe('2026-09');
    for (const bad of ['2026-13', '2026-9', '202609', '2026-09-01', ''])
      expect(() => normalizePeriod(bad)).toThrow(PosError);
  });
});

describe('periodLockExists — the month is read in the org accounting timezone, never UTC', () => {
  it('resolves the month through fin_settings.timezone with a Lima fallback, for one instant', () => {
    const { sql, params } = render(periodLockExists('org-1', new Date('2026-11-01T03:30:00Z')));
    const lower = sql.toLowerCase();
    expect(lower).toContain('from pos_period_locks');
    expect(lower).toContain('at time zone coalesce');
    expect(lower).toContain('fin_settings');
    expect(lower).toContain("'yyyy-mm'");
    // 2026-11-01 03:30Z is still 31 October in Lima — the parameter is the
    // instant, the month is Postgres' business.
    expect(params).toContain('2026-11-01T03:30:00.000Z');
    expect(params).toContain('org-1');
  });

  it('takes a column for set-based filters (the shift close batch)', () => {
    const { sql } = render(periodLockExists('org-1', posTickets.submittedAt));
    expect(sql.toLowerCase()).toContain('"submitted_at" at time zone');
  });
});
