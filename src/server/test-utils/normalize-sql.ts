/**
 * Collapses insignificant whitespace (indentation, line breaks) in a compiled
 * SQL string so a full-query parity assertion isn't brittle to reformatting,
 * while still catching structural drift (joins, grouping, ordering, selected
 * columns) that a fragment-only `toContain` check would miss.
 */
export function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}
