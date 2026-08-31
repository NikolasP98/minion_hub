import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  DEFAULT_DEPOSIT_RULE,
  DEPOSIT_KEYWORDS_MAX,
  DEPOSIT_KEYWORD_MAX_LENGTH,
  depositMatchSql,
  depositSortKeySql,
  depositWriteSchema,
  notDepositMatchSql,
  escapeLikePattern,
  isDepositText,
  type DepositRule,
} from './crm-deposit-rule';
import { DEPOSIT_TEXT_CASES } from './crm-deposit-rule.fixtures';

const dialect = new PgDialect();
const render = (frag: ReturnType<typeof depositMatchSql>) => dialect.sqlToQuery(frag);

describe('DEFAULT_DEPOSIT_RULE', () => {
  it('is the FACES-era default — the only occurrence of "reserva" outside this module/tests', () => {
    expect(DEFAULT_DEPOSIT_RULE).toEqual({
      keywords: ['reserva'],
      // The exact caption crm-journey.service.ts hardcoded before the rule
      // existed, so an org with no crm_settings.value.deposit row keeps
      // byte-identical output (S2 zero-regression clause).
      label: 'Reserved a consult',
    });
  });
});

describe('escapeLikePattern', () => {
  it('wraps the keyword in %…%', () => {
    expect(escapeLikePattern('reserva')).toBe('%reserva%');
  });

  it('escapes %, _ and \\ so operator input can never widen into a wildcard', () => {
    expect(escapeLikePattern('100%')).toBe('%100\\%%');
    expect(escapeLikePattern('a_b')).toBe('%a\\_b%');
    expect(escapeLikePattern('a\\b')).toBe('%a\\\\b%');
  });
});

describe('depositMatchSql / notDepositMatchSql', () => {
  it('single-keyword rule renders one bound ILIKE clause, coalesced to a total boolean', () => {
    const { sql, params } = render(depositMatchSql('ii.description', DEFAULT_DEPOSIT_RULE));
    expect(sql).toBe('coalesce((ii.description ilike $1), false)');
    expect(params).toEqual(['%reserva%']);
  });

  it('notDepositMatchSql renders the negated, bound clause, coalesced to a total boolean', () => {
    const { sql, params } = render(notDepositMatchSql('ii.description', DEFAULT_DEPOSIT_RULE));
    expect(sql).toBe('coalesce((ii.description not ilike $1), true)');
    expect(params).toEqual(['%reserva%']);
  });

  it('multi-keyword rule ORs deposit matches and ANDs non-matches', () => {
    const rule: DepositRule = { keywords: ['adelanto', 'seña'], label: 'Adelanto' };
    const pos = render(depositMatchSql('ii.description', rule));
    expect(pos.sql).toBe('coalesce((ii.description ilike $1 or ii.description ilike $2), false)');
    expect(pos.params).toEqual(['%adelanto%', '%seña%']);

    const neg = render(notDepositMatchSql('ii.description', rule));
    expect(neg.sql).toBe(
      'coalesce((ii.description not ilike $1 and ii.description not ilike $2), true)',
    );
    expect(neg.params).toEqual(['%adelanto%', '%seña%']);
  });

  it('empty keywords ⇒ depositMatchSql is `false` and notDepositMatchSql is `true` — never undefined', () => {
    const rule: DepositRule = { keywords: [], label: 'x' };
    const pos = depositMatchSql('ii.description', rule);
    const neg = notDepositMatchSql('ii.description', rule);
    expect(pos).toBeDefined();
    expect(neg).toBeDefined();
    expect(render(pos)).toMatchObject({ sql: 'false', params: [] });
    expect(render(neg)).toMatchObject({ sql: 'true', params: [] });
  });
});

describe('depositSortKeySql', () => {
  it('wraps the predicate in a CASE so a keyword rule sorts procedures (0) before deposits (1)', () => {
    const { sql, params } = render(depositSortKeySql('ii.description', DEFAULT_DEPOSIT_RULE));
    expect(sql).toBe('(case when coalesce((ii.description ilike $1), false) then 1 else 0 end)');
    expect(params).toEqual(['%reserva%']);
  });

  it('stays a CASE for a ZERO-keyword rule — `order by false` is a PostgreSQL 42601', () => {
    // This is the whole reason the helper exists: depositMatchSql compiles an
    // empty rule to the literal `false`, which PostgreSQL rejects as a sort
    // key ("non-integer constant in ORDER BY"). Every ORDER BY on deposit-ness
    // goes through here, so an org that configured `keywords: []` still gets a
    // query that runs.
    const { sql, params } = render(
      depositSortKeySql('ii.description', { keywords: [], label: 'x' }),
    );
    expect(sql).toBe('(case when false then 1 else 0 end)');
    expect(params).toEqual([]);
  });
});

describe('isDepositText', () => {
  const rule = DEFAULT_DEPOSIT_RULE;

  // Same cases as crm-deposit-rule.sql.integration.test.ts, which evaluates
  // depositMatchSql/notDepositMatchSql against real PostgreSQL ILIKE for this
  // exact table — that test is where isDepositText's agreement with the SQL
  // side is actually established; this one only proves the TS function itself.
  it.each(DEPOSIT_TEXT_CASES)('isDepositText(%j) → %s', (text, expected) => {
    expect(isDepositText(text, rule)).toBe(expected);
  });

  it('treats null/undefined as non-deposit — the same total-boolean contract depositMatchSql/notDepositMatchSql coalesce a NULL column to (see crm-deposit-rule.sql.integration.test.ts for the real-Postgres agreement)', () => {
    expect(isDepositText(null, rule)).toBe(false);
    expect(isDepositText(undefined, rule)).toBe(false);
  });
});

describe('isDepositText with multiple keywords', () => {
  const rule: DepositRule = { keywords: ['adelanto', 'seña', 'abono'], label: 'Adelanto' };
  it('matches any configured keyword', () => {
    expect(isDepositText('ADELANTO 50%', rule)).toBe(true);
    expect(isDepositText('dejó una seña', rule)).toBe(true);
    expect(isDepositText('Reserva de Consulta', rule)).toBe(false);
  });
});

describe('depositWriteSchema (the WRITE boundary — strict, rejects instead of clamping)', () => {
  it('accepts a valid rule, including an explicitly empty keyword list', () => {
    expect(
      depositWriteSchema.safeParse({ keywords: ['adelanto'], label: 'Adelanto' }).success,
    ).toBe(true);
    expect(depositWriteSchema.safeParse({ keywords: [] }).success).toBe(true);
  });

  it(`REJECTS (does not truncate) a keyword longer than ${DEPOSIT_KEYWORD_MAX_LENGTH} characters`, () => {
    expect(depositWriteSchema.safeParse({ keywords: ['x'.repeat(80)] }).success).toBe(false);
  });

  it(`REJECTS (does not cap) more than ${DEPOSIT_KEYWORDS_MAX} keywords`, () => {
    const tooMany = Array.from({ length: DEPOSIT_KEYWORDS_MAX + 1 }, (_, i) => `kw${i}`);
    expect(depositWriteSchema.safeParse({ keywords: tooMany }).success).toBe(false);
  });

  it('rejects unknown keys, and refuses a client-supplied updatedAt (the handler stamps it)', () => {
    expect(depositWriteSchema.safeParse({ keywords: ['ok'], surprise: 1 }).success).toBe(false);
    expect(
      depositWriteSchema.safeParse({ keywords: ['ok'], updatedAt: '2026-08-20T00:00:00Z' }).success,
    ).toBe(false);
  });

  it('rejects blank and non-string keywords', () => {
    expect(depositWriteSchema.safeParse({ keywords: ['  '] }).success).toBe(false);
    expect(depositWriteSchema.safeParse({ keywords: [1] }).success).toBe(false);
  });
});

// S3 anti-recurrence guard (2026-08-17-hub-reserva-keyword-config-spec §S3):
// makes "one shared constant" permanent instead of a one-time grep in a spec.
// Verified locally by adding `ilike('%reserva%')` to crm-journey.service.ts
// and confirming this test fails, then reverting.
describe('anti-recurrence guard — no second hardcoded deposit keyword', () => {
  it('no server file (anywhere, not just a hand-maintained list) hardcodes /reserva/i or a string-built ILIKE pattern', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const path = await import('node:path');
    const servicesDir = fileURLToPath(new URL('.', import.meta.url));
    const serverDir = path.join(servicesDir, '..');
    // The canonical rule module and its fixture are the ONLY files allowed to
    // say "reserva" — everything else must go through
    // depositMatchSql/notDepositMatchSql/escapeLikePattern. Excluding a
    // hand-maintained consumer allowlist (the S0 amendment this guard
    // implements) instead of hardcoding which files are "consumers", so a
    // brand-new service that hardcodes the keyword or hand-builds an ILIKE
    // still trips this test instead of silently diverging.
    const exempt = new Set(
      ['crm-deposit-rule.ts', 'crm-deposit-rule.fixtures.ts'].map((f) => path.join(servicesDir, f)),
    );

    function walk(dir: string, out: string[]): string[] {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full, out);
        } else if (/\.(ts|js)$/.test(entry) && !/\.test\.(ts|js)$/.test(entry)) {
          out.push(full);
        }
      }
      return out;
    }

    const files = walk(serverDir, []).filter((f) => !exempt.has(f));
    expect(files.length).toBeGreaterThan(100); // sanity: the walk actually found the tree

    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      // Global: the keyword itself must never reappear anywhere on the
      // server, deposit-related file or not.
      expect(
        source,
        `${file} must not hardcode the keyword — use depositMatchSql/notDepositMatchSql`,
      ).not.toMatch(/reserva/i);

      // Scoped: a raw hand-built ILIKE pattern is only a deposit-rule
      // violation in a file that is actually in the deposit domain — plenty
      // of unrelated server code (e.g. campaign-name matching) legitimately
      // hardcodes its own ILIKE literals for a different business rule, and
      // banning ILIKE literals sitewide would just be noise unrelated to
      // this guard's claim.
      if (!/deposit/i.test(source)) continue;
      expect(
        source,
        `${file} must not build an ILIKE pattern by string concatenation — use escapeLikePattern`,
      ).not.toMatch(/ilike\s*\(\s*[a-zA-Z0-9_.]+\s*,\s*[`'"]%/);
      // The function-call check above only catches Drizzle's `ilike(col, '%x%')`
      // form. This codebase's deposit/search predicates are written as raw SQL
      // inside `sql` tagged templates instead (infix `col ilike '%x%'`), which
      // that regex never sees — this second check is the one that would have
      // caught a hand-built `ii.description ilike '%adelanto%'` bypassing
      // depositMatchSql. Deliberately does NOT flag an interpolated pattern
      // (`ilike ${'%' + variable + '%'}`, crm-contacts.service.ts's legitimate
      // name-search predicate) — only a LITERAL quoted string sitting directly
      // after the keyword.
      expect(
        source,
        `${file} must not hardcode a raw ILIKE literal pattern — use depositMatchSql/notDepositMatchSql`,
      ).not.toMatch(/ilike\s+[`'"]%/i);
    }
  });
});
