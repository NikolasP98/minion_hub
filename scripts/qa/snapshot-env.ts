/**
 * Pure helpers for scripts/qa/snapshot-prod-schema.ts — kept separate from
 * the (owner-run, DB-touching, never-executed-by-an-agent) orchestrator so
 * they can be unit tested without a database or a real .env.local file.
 */

/** Minimal `.env`-style parser: `KEY=value` per line, `#` comments, optional quotes. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * pg_dump needs session-mode semantics; Supabase's connection pooler on port
 * 6543 runs in transaction mode. Rewrite that one port to the session pooler
 * (5432) and leave every other URL untouched.
 */
export function toSessionPoolerUrl(raw: string): { url: string; rewritten: boolean } {
  const url = new URL(raw);
  if (url.port !== '6543') return { url: raw, rewritten: false };
  url.port = '5432';
  return { url: url.toString(), rewritten: true };
}

/** Safe-to-log form of a Postgres connection URL: password replaced, nothing else. */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return '<unparseable connection url>';
  }
}
