/** Pure TSV/HTML clipboard helpers for DataTable range & row copy, and TSV
 *  parsing for paste. Dependency-free and DOM-free so spreadsheet-compat
 *  (Excel/LibreOffice/Google Sheets) can be unit-tested without a browser. */

function needsQuoting(cell: string): boolean {
  return cell.includes('\t') || cell.includes('\n') || cell.includes('"');
}

function quoteTsvCell(cell: string): string {
  return needsQuoting(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/** Tab-separated, newline-per-row — what Excel/Sheets/LibreOffice write and
 *  read for `text/plain` cell-range clipboard data. */
export function toTsv(rows: string[][]): string {
  return rows.map((row) => row.map(quoteTsvCell).join('\t')).join('\n');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** `text/html` counterpart — a plain `<table>` is what spreadsheet apps
 *  parse for cell-range paste (richer than the TSV fallback). */
export function toHtmlTable(rows: string[][]): string {
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('');
  return `<table>${body}</table>`;
}

/** Parses TSV/CSV-ish clipboard text: tabs between cells, newlines between
 *  rows, `"`-quoted cells with `""` escaping (RFC 4180 §2.5–2.7) — matches
 *  what Excel/Sheets/LibreOffice put on the clipboard. A single trailing
 *  blank line (common when a source added a final newline) is dropped. */
export function parseTsv(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;
  while (i < normalized.length) {
    const ch = normalized[i];
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell === '') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === '\t') {
      row.push(cell);
      cell = '';
      i++;
      continue;
    }
    if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
      continue;
    }
    cell += ch;
    i++;
  }
  row.push(cell);
  rows.push(row);
  const last = rows[rows.length - 1];
  if (rows.length > 1 && last.length === 1 && last[0] === '') rows.pop();
  return rows;
}
