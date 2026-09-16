/**
 * Sanitizes raw `pg_dump` output for the committed QA baseline
 * (supabase/qa/baseline/schema.sql, ledger.sql — see
 * specs/2026-09-16-hub-local-qa-stack-spec.md §3).
 *
 * Goal: a diff between two snapshots shows real schema change, not
 * session-preamble noise (`SET ...;`, pg_dump's own comments, the
 * `\restrict`/`\unrestrict` guard pg_dump >=17 wraps the file in). GRANT/
 * REVOKE/ALTER DEFAULT PRIVILEGES/policies/triggers/function bodies are
 * always kept, and statement order is never changed.
 *
 * One SET is NOT noise: `SET check_function_bodies = false;`. Postgres
 * validates a PL/pgSQL function body's table/column references at
 * CREATE FUNCTION time unless that's off, and pg_dump's DDL order can (and
 * for this schema does) define a function before a table it references —
 * dropping this line makes an otherwise-correct dump fail to restore with
 * "relation ... does not exist" from inside function compilation.
 *
 * Pure and side-effect free so it can run against a fixture in tests without
 * a database or a real pg_dump binary.
 */

const DROP_PATTERNS: RegExp[] = [
  /^--/, // pg_dump's own "-- Name: ..." / "-- PostgreSQL database dump" comments
  /^SET\s+(?!check_function_bodies\b)\S/i, // session preamble: SET statement_timeout = 0; etc. — keeps check_function_bodies
  /^SELECT\s+pg_catalog\.set_config\(\s*'search_path'/i,
  /^\\restrict\b/,
  /^\\unrestrict\b/,
];

/**
 * Toggles dollar-quote state across the whole file so filtering never
 * touches a line inside a function/trigger body (which can legitimately
 * contain text that looks like a `SET ...;` line). Postgres dollar-quote
 * tags don't nest with themselves, so a simple "currently open tag or not"
 * model matches real dump output.
 */
function nextDollarTag(line: string, currentTag: string | null): string | null {
  const tokens = line.match(/\$[A-Za-z0-9_]*\$/g);
  if (!tokens) return currentTag;
  let tag = currentTag;
  for (const token of tokens) {
    if (tag === null) {
      tag = token; // opens a dollar-quoted body
    } else if (token === tag) {
      tag = null; // closes it
    }
    // any other $foo$ token while already inside a different-tagged body
    // is just literal text inside that body — ignore it.
  }
  return tag;
}

export function sanitizeDump(raw: string): string {
  const lines = raw.split('\n');
  const out: string[] = [];
  let dollarTag: string | null = null;

  for (const line of lines) {
    const insideBody = dollarTag !== null;
    const trimmed = line.trimEnd();

    if (!insideBody) {
      const trimmedStart = trimmed.trimStart();
      const shouldDrop = DROP_PATTERNS.some((pattern) => pattern.test(trimmedStart));
      if (shouldDrop) {
        dollarTag = nextDollarTag(line, dollarTag);
        continue;
      }
    }

    out.push(trimmed);
    dollarTag = nextDollarTag(line, dollarTag);
  }

  // Exactly one trailing newline, no trailing blank lines — keeps re-runs
  // of the same source dump byte-identical instead of accreting blank
  // lines where dropped statements used to be.
  while (out.length > 0 && out[out.length - 1] === '') {
    out.pop();
  }
  return out.join('\n') + '\n';
}
