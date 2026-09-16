/**
 * Converts pg_dump's `COPY ... FROM stdin;` text-format data blocks into
 * plain `INSERT` statements.
 *
 * scripts/qa/snapshot-prod-schema.ts dumps supabase/qa/baseline/ledger.sql
 * with `--inserts` precisely to avoid needing this, but db-bootstrap.ts's
 * psql-less fallback (`postgres.js` `sql.unsafe()`) speaks the simple query
 * protocol only — it cannot run a COPY block — so this is kept as a tolerance
 * layer for any baseline (older snapshot, hand-edited fixture) that still
 * uses the COPY-format pg_dump default. Everything outside a COPY block
 * passes through unchanged.
 */

const COPY_HEADER = /^COPY\s+(\S+)\s*\(([^)]*)\)\s+FROM\s+stdin;\s*$/i;

/** Un-escapes one COPY TEXT-format field. Returns null for the `\N` NULL marker. */
function unescapeCopyField(field: string): string | null {
  if (field === '\\N') return null;
  let result = '';
  for (let i = 0; i < field.length; i++) {
    const ch = field[i];
    if (ch === '\\' && i + 1 < field.length) {
      const next = field[i + 1];
      if (next === 't') {
        result += '\t';
        i++;
      } else if (next === 'n') {
        result += '\n';
        i++;
      } else if (next === 'r') {
        result += '\r';
        i++;
      } else if (next === '\\') {
        result += '\\';
        i++;
      } else {
        result += ch; // unrecognized escape — keep the backslash literally
      }
    } else {
      result += ch;
    }
  }
  return result;
}

function sqlLiteral(value: string | null): string {
  if (value === null) return 'NULL';
  return `'${value.replace(/'/g, "''")}'`;
}

export function copyBlocksToInserts(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const header = lines[i].match(COPY_HEADER);
    if (!header) {
      out.push(lines[i]);
      i++;
      continue;
    }
    const [, table, columnList] = header;
    const columns = columnList.split(',').map((c) => c.trim());
    i++;
    while (i < lines.length && lines[i] !== '\\.') {
      const fields = lines[i].split('\t').map(unescapeCopyField);
      out.push(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${fields.map(sqlLiteral).join(', ')});`,
      );
      i++;
    }
    i++; // skip the terminating "\."
  }
  return out.join('\n');
}
