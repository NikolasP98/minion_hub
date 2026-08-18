import postgres from 'postgres';
import { loadEnv } from 'vite';
import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  DEFAULT_DEPOSIT_RULE,
  depositMatchSql,
  notDepositMatchSql,
  escapeLikePattern,
  isDepositText,
  type DepositRule,
} from './crm-deposit-rule';
import { DEPOSIT_TEXT_CASES } from './crm-deposit-rule.fixtures';

/**
 * Runs `depositMatchSql`/`notDepositMatchSql` against REAL PostgreSQL — the
 * repo rule against testing hand-copied reimplementations means the ILIKE
 * oracle here must be the database itself, never a local regex translator.
 * `crm-finance.service.ts`, `crm-similarity.service.ts` and
 * `crm-journey.service.ts` compose their `IS_DEPOSIT`/`IS_PROCEDURE`
 * predicates from exactly these two functions (see crm-deposit-rule.ts), so
 * proving them correct here is the query-level classification coverage for
 * all three services — the mock-based tests in their *.service.test.ts files
 * only cover the JS-side row→field mapping, not this SQL semantics.
 */

// TODO(handoff): CI leaves SUPABASE_DB_URL empty (.env.example:141, no override in
// .github/workflows/ci.yml) so this suite is always skipped in the enforced gate. This file
// only needs a bare `postgres` service (VALUES-probe queries, no app schema), so it is safe to
// wire independently of the documented full-schema-not-reproducible blocker (see hub memory
// hub-supabase-schema-not-reproducible.md) — but SUPABASE_DB_URL is also read by
// brain-business-corpus.sql.integration.test.ts, pg-client.test.ts, pg-pool.test.ts,
// brain-business-persistence.service.test.ts and layout.server.test.ts, some of which DO expect
// the full prod schema, so turning the env var on globally would need those checked first. Add
// a job-scoped service + isolated env instead of a blanket CI env var.
const databaseUrl =
  process.env.SUPABASE_DB_URL ?? loadEnv('development', process.cwd(), '').SUPABASE_DB_URL;

const dialect = new PgDialect();

/** Renders `frag` (built against column `probe.text`) and runs it in `client`
 *  as the WHERE-position of a one-row VALUES probe, returning the boolean the
 *  database itself computed. */
async function evalPredicate(
  client: ReturnType<typeof postgres>,
  frag: SQL,
  text: string | null,
): Promise<boolean> {
  const { sql: whereSql, params } = dialect.sqlToQuery(frag);
  const bound = [...params, text] as never[];
  const textPlaceholder = `$${params.length + 1}`;
  const rows = await client.unsafe<{ matches: boolean }[]>(
    `select (${whereSql}) as matches from (values (${textPlaceholder}::text)) as probe(text)`,
    bound,
  );
  return Boolean(rows[0].matches);
}

/** Runs `bool_or(frag)` (built against column `probe.text`) over several seeded
 *  rows, mirroring how the services aggregate per-invoice/per-contact line
 *  items — the exact shape `IS_DEPOSIT`/`IS_PROCEDURE` are used in. */
async function evalBoolOr(client: ReturnType<typeof postgres>, frag: SQL, texts: (string | null)[]): Promise<boolean> {
  const { sql: whereSql, params } = dialect.sqlToQuery(frag);
  const rowsSql = texts
    .map((_, i) => `($${params.length + i + 1}::text)`)
    .join(', ');
  const rows = await client.unsafe<{ result: boolean }[]>(
    `select bool_or(${whereSql}) as result from (values ${rowsSql}) as probe(text)`,
    [...params, ...texts] as never[],
  );
  return Boolean(rows[0].result);
}

describe.runIf(Boolean(databaseUrl))('crm-deposit-rule against PostgreSQL', () => {
  it('isDepositText agrees with depositMatchSql/notDepositMatchSql for every case in the shared table', async () => {
    const client = postgres(databaseUrl!, { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 10 });
    try {
      for (const [text, expected] of DEPOSIT_TEXT_CASES) {
        const isMatch = await evalPredicate(client, depositMatchSql('probe.text', DEFAULT_DEPOSIT_RULE), text);
        const isNotMatch = await evalPredicate(client, notDepositMatchSql('probe.text', DEFAULT_DEPOSIT_RULE), text);
        expect(isMatch, `depositMatchSql(${JSON.stringify(text)})`).toBe(expected);
        expect(isNotMatch, `notDepositMatchSql(${JSON.stringify(text)})`).toBe(!expected);
        expect(isDepositText(text, DEFAULT_DEPOSIT_RULE), `isDepositText(${JSON.stringify(text)})`).toBe(expected);
      }
    } finally {
      await client.end({ timeout: 5 });
    }
  }, 30_000);

  it('multi-keyword rule: PostgreSQL OR/AND semantics agree with isDepositText for every keyword', async () => {
    const client = postgres(databaseUrl!, { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 10 });
    const rule: DepositRule = { keywords: ['adelanto', 'seña', 'abono'], label: 'Adelanto' };
    const cases: Array<[string, boolean]> = [
      ['ADELANTO 50%', true],
      ['dejó una seña', true],
      ['pagó un abono', true],
      ['Reserva de Consulta', false],
      ['Botox completo', false],
    ];
    try {
      for (const [text, expected] of cases) {
        const isMatch = await evalPredicate(client, depositMatchSql('probe.text', rule), text);
        expect(isMatch, text).toBe(expected);
        expect(isDepositText(text, rule), text).toBe(expected);
      }
    } finally {
      await client.end({ timeout: 5 });
    }
  }, 30_000);

  it("escapeLikePattern('100%') does not let an operator keyword widen into a wildcard", async () => {
    const client = postgres(databaseUrl!, { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 10 });
    const rule: DepositRule = { keywords: ['100%'], label: '100%' };
    try {
      expect(await evalPredicate(client, depositMatchSql('probe.text', rule), 'anything')).toBe(false);
      expect(await evalPredicate(client, depositMatchSql('probe.text', rule), 'this costs 100% today')).toBe(true);
      expect(await evalPredicate(client, depositMatchSql('probe.text', rule), 'this costs 100 today')).toBe(false);
      // escapeLikePattern itself agrees on the rendered pattern text
      expect(escapeLikePattern('100%')).toBe('%100\\%%');
    } finally {
      await client.end({ timeout: 5 });
    }
  }, 30_000);

  it('classifies a deposit-worded row and a procedure-worded row on opposite sides of IS_DEPOSIT/IS_PROCEDURE — the predicate crm-finance/crm-journey/crm-similarity share', async () => {
    const client = postgres(databaseUrl!, { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 10 });
    const rule = DEFAULT_DEPOSIT_RULE;
    try {
      // A contact whose only line item is a deposit: bool_or(IS_DEPOSIT) is true,
      // bool_or(IS_PROCEDURE) is false — the exact `has_deposit`/`has_proc` pair
      // crm-finance.service.ts's reservedOnly / crm-journey.service.ts's
      // 'reserve' branch, and crm-similarity.service.ts's `having bool_or(...)`
      // buyer filter all key off.
      const depositOnly = ['Reserva de Consulta'];
      expect(await evalBoolOr(client, depositMatchSql('probe.text', rule), depositOnly)).toBe(true);
      expect(
        await evalBoolOr(
          client,
          notDepositMatchSql('probe.text', rule),
          depositOnly,
        ),
      ).toBe(false);

      // A contact with a real procedure line: the reverse.
      const procedureOnly = ['Botox completo'];
      expect(await evalBoolOr(client, depositMatchSql('probe.text', rule), procedureOnly)).toBe(false);
      expect(await evalBoolOr(client, notDepositMatchSql('probe.text', rule), procedureOnly)).toBe(true);

      // A contact with both: bool_or means "has at least one" — both flags true,
      // which is what lets a procedure line override reservedOnly downstream.
      const mixed = ['Reserva de Consulta', 'Botox completo'];
      expect(await evalBoolOr(client, depositMatchSql('probe.text', rule), mixed)).toBe(true);
      expect(await evalBoolOr(client, notDepositMatchSql('probe.text', rule), mixed)).toBe(true);
    } finally {
      await client.end({ timeout: 5 });
    }
  }, 30_000);

  it('contactFinanceSummary/contactJourney representative-item ORDER BY puts the procedure line before the deposit line at equal price', async () => {
    const client = postgres(databaseUrl!, { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 10 });
    const rule = DEFAULT_DEPOSIT_RULE;
    const { sql: whereSql, params } = dialect.sqlToQuery(depositMatchSql('probe.text', rule));
    try {
      // Same ORDER BY as contactFinanceSummary's `item` subquery and
      // deterministicMilestones' `item` subquery: deposit-match ASC (false=0
      // sorts first) then total DESC — at equal total, the procedure line wins.
      const rows = await client.unsafe<{ text: string }[]>(
        `select text from (values ($${params.length + 1}::text, 100::float8), ($${params.length + 2}::text, 100::float8)) as probe(text, total)
         order by (${whereSql}) asc, total desc nulls last limit 1`,
        [...params, 'Reserva de Consulta', 'Botox completo'] as never[],
      );
      expect(rows[0].text).toBe('Botox completo');
    } finally {
      await client.end({ timeout: 5 });
    }
  }, 30_000);
});
