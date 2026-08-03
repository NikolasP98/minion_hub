/**
 * Deterministic bank-statement CSV/text parser (WP4, R5 — no LLM in this
 * wave). Pure functions, no I/O — testable in isolation and safe to call
 * repeatedly for the same content (used by the resumable bg-runtime chunker).
 *
 * Contract: every input data row lands in exactly one of `rows` (accepted) or
 * `rejected` (with a reason). Ambiguous column mapping (can't confidently find
 * date+description+amount) rejects EVERY data row with reason 'needs-llm' —
 * the gateway drone fallback is a later cross-repo wave (R5/WP5).
 */

export interface StatementEntryOk {
  sourceRow: number;
  ok: true;
  postedOn: string; // 'YYYY-MM-DD'
  description: string;
  signedAmount: string; // fixed(2) numeric string; sign = direction
  currency: string | null;
  counterparty: string | null;
  category: string | null;
  reference: string | null;
  confidence: number | null;
  warnings: string[];
  raw: Record<string, string>;
}

export interface StatementEntryRejected {
  sourceRow: number;
  ok: false;
  reason: string;
  raw: Record<string, string>;
}

export type StatementEntry = StatementEntryOk | StatementEntryRejected;

export interface StatementParseResult {
  /** All data rows in original file order — the chunk cursor slices this. */
  entries: StatementEntry[];
  rows: StatementEntryOk[];
  rejected: StatementEntryRejected[];
  /** Recognized field keys detected in the header, for diagnostics. */
  headerFields: string[];
}

/** Normalize pasted-text line endings so identical content hashes identically
 *  regardless of the client OS clipboard (CRLF/CR → LF). */
export function normalizeStatementText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

interface CsvRow {
  cells: string[];
  /** A quote was opened mid-field (not at field start) or a closing quote
   *  wasn't immediately followed by a delimiter/EOL/EOF (e.g. `"Grocer"oops`),
   *  or a quote was never closed before EOF. The row's cells are best-effort
   *  only — callers should reject the row rather than trust them. */
  malformed: boolean;
}

// ── CSV tokenizer (minimal RFC4180: quoted fields, "" escape, embedded commas/newlines) ──
function splitCsvRows(text: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldStarted = false; // has any char landed in the current field yet?
  let rowMalformed = false;
  let sawAny = false;

  const endField = () => {
    row.push(field);
    field = '';
    fieldStarted = false;
  };
  const endRow = () => {
    endField();
    rows.push({ cells: row, malformed: rowMalformed });
    row = [];
    rowMalformed = false;
    sawAny = false;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
          // Only a delimiter/EOL/EOF may follow a closing quote.
          const next = text[i + 1];
          if (next !== undefined && next !== ',' && next !== '\n' && next !== '\r') {
            rowMalformed = true;
          }
        }
      } else {
        field += c;
      }
      continue;
    }
    // Quote mode only starts a field — a `"` appearing after the field has
    // already begun (e.g. `Grocer"oops`) is a stray/malformed quote, not a
    // re-entry into quoted content.
    if (c === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
      sawAny = true;
      continue;
    }
    if (c === '"') {
      rowMalformed = true;
      field += c;
      fieldStarted = true;
      sawAny = true;
      continue;
    }
    if (c === ',') {
      endField();
      sawAny = true;
      continue;
    }
    if (c === '\n') {
      endRow();
      continue;
    }
    if (c === '\r') continue; // normalize CRLF/bare-CR
    field += c;
    fieldStarted = true;
    sawAny = true;
  }
  if (inQuotes) rowMalformed = true; // unterminated quote at EOF
  if (sawAny || field.length > 0 || row.length > 0) {
    endRow();
  }
  return rows.filter((r) => !(r.cells.length === 1 && r.cells[0].trim() === '' && !r.malformed));
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function normHeader(s: string): string {
  return stripAccents(s.trim().toLowerCase()).replace(/\s+/g, ' ');
}

const FIELD_ALIASES: Record<string, string[]> = {
  date: [
    'date',
    'fecha',
    'transaction date',
    'posted date',
    'value date',
    'fecha operacion',
    'fecha de operacion',
  ],
  description: ['description', 'descripcion', 'detalle', 'concepto', 'memo', 'glosa'],
  amount: ['amount', 'monto', 'importe', 'valor'],
  debit: ['debit', 'cargo', 'debito', 'egreso'],
  credit: ['credit', 'abono', 'credito', 'ingreso'],
  currency: ['currency', 'moneda'],
  counterparty: ['counterparty', 'beneficiario', 'contraparte', 'payee'],
  category: ['category', 'categoria', 'rubro'],
  reference: [
    'reference',
    'referencia',
    'ref',
    'nro operacion',
    'numero de operacion',
    'no operacion',
  ],
};

function detectColumns(header: string[]): Partial<Record<string, number>> {
  const map: Partial<Record<string, number>> = {};
  header.forEach((h, idx) => {
    const norm = normHeader(h);
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (map[field] === undefined && aliases.includes(norm)) map[field] = idx;
    }
  });
  return map;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
function isValidYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12) return false;
  const isLeap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const dim = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d >= 1 && d <= dim[m - 1];
}

/** Resolve ISO / DD-MM-YYYY / MM-DD-YYYY. Genuinely ambiguous two-digit-both
 *  cases (e.g. 03/04/2026) default to DD/MM/YYYY (hub's America/Lima locale
 *  default — see fin_settings.timezone) and are flagged `ambiguous`. */
export function parseStatementDate(raw: string): { iso: string; ambiguous: boolean } | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (!isValidYmd(y, mo, d)) return null;
    return { iso: `${y}-${pad2(mo)}-${pad2(d)}`, ambiguous: false };
  }
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]);
    let day: number;
    let month: number;
    let ambiguous = false;
    if (a > 12 && b <= 12) {
      day = a;
      month = b;
    } else if (b > 12 && a <= 12) {
      day = b;
      month = a;
    } else if (a <= 12 && b <= 12) {
      day = a;
      month = b;
      ambiguous = true;
    } else {
      return null;
    }
    if (!isValidYmd(y, month, day)) return null;
    return { iso: `${y}-${pad2(month)}-${pad2(day)}`, ambiguous };
  }
  return null;
}

const STRICT_GROUPING_RE = /^\d{1,3}(?:[,.]\d{3})+$/;

interface AmountAnalysis {
  negative: boolean;
  /** Canonical dot-decimal numeric string, resolved unambiguously. Null when
   *  unresolved (either genuinely invalid, or structurally ambiguous — see
   *  `ambiguous`). */
  canonical: string | null;
  /** A single lone separator followed by exactly 3 digits (e.g. "1.234") is
   *  structurally indistinguishable between thousands grouping (1234) and a
   *  rare decimal amount with 3 decimal places — cannot resolve without
   *  column-wide context. Two-or-more repeated groups (e.g. "12.345.678")
   *  have no valid decimal reading, so those stay unambiguous thousands. */
  ambiguous: boolean;
  ambiguousSep?: ',' | '.';
  ambiguousAsDecimal?: string;
  ambiguousAsThousands?: string;
  /** When a lone separator was unambiguously resolved (decimal via 1-2
   *  trailing digits, or either side of a two-separator amount), the char
   *  that served as the decimal separator — lets callers learn a column's
   *  locale convention from its unambiguous rows. */
  decimalChar?: ',' | '.';
}

function analyzeAmount(raw: string): AmountAnalysis {
  let s = raw.trim();
  if (s === '') return { negative: false, canonical: null, ambiguous: false };
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[^0-9.,+-]/g, '');
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  } else if (s.endsWith('-')) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith('+')) s = s.slice(1);
  if (s === '') return { negative, canonical: null, ambiguous: false };

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  if (lastComma !== -1 && lastDot !== -1) {
    const commaIsDecimal = lastDot < lastComma;
    const canonical = commaIsDecimal
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
    return { negative, canonical, ambiguous: false, decimalChar: commaIsDecimal ? ',' : '.' };
  }

  if (lastComma !== -1 || lastDot !== -1) {
    const sep: ',' | '.' = lastComma !== -1 ? ',' : '.';
    const sepIdx = lastComma !== -1 ? lastComma : lastDot;
    const trailing = s.length - sepIdx - 1;
    const groupCount = s.split(sep).length - 1;

    if (trailing === 1 || trailing === 2) {
      return { negative, canonical: s.replace(sep, '.'), ambiguous: false, decimalChar: sep };
    }
    if (STRICT_GROUPING_RE.test(s)) {
      if (groupCount >= 2) {
        return { negative, canonical: s.split(sep).join(''), ambiguous: false };
      }
      // Exactly one group of 3 trailing digits — genuinely ambiguous.
      return {
        negative,
        canonical: null,
        ambiguous: true,
        ambiguousSep: sep,
        ambiguousAsDecimal: s.replace(sep, '.'),
        ambiguousAsThousands: s.split(sep).join(''),
      };
    }
    return { negative, canonical: null, ambiguous: false };
  }

  return { negative, canonical: s, ambiguous: false };
}

function toNumber(a: AmountAnalysis): number | null {
  if (a.canonical === null) return null;
  const n = Number(a.canonical);
  if (!Number.isFinite(n)) return null;
  return a.negative ? -n : n;
}

/** Resolve an ambiguous single-group amount (e.g. "1.234") using a
 *  column-wide decimal-separator convention learned from other rows. Returns
 *  null (unresolved) when there's no convention, or the convention doesn't
 *  cover this separator. */
function resolveAmbiguous(a: AmountAnalysis, convention: ',' | '.' | undefined): number | null {
  if (!a.ambiguous || !a.ambiguousSep || !convention) return null;
  const canonical = a.ambiguousSep === convention ? a.ambiguousAsDecimal : a.ambiguousAsThousands;
  if (canonical === undefined) return null;
  const n = Number(canonical);
  if (!Number.isFinite(n)) return null;
  return a.negative ? -n : n;
}

/** Resolve "1.234,56" (EU) vs "1,234.56" (US) vs plain thousands grouping.
 *  Parentheses and a leading/trailing '-' mean negative. A lone separator is
 *  read as a decimal point when 1-2 digits follow it; a lone separator with
 *  exactly one group of 3 trailing digits (e.g. "1.234") is structurally
 *  ambiguous and returns null here — resolve it with column context via
 *  `parseStatementCsv` instead of guessing. */
export function parseStatementAmount(raw: string): number | null {
  return toNumber(analyzeAmount(raw));
}

/** Learn a column-wide decimal-separator convention from every unambiguous
 *  cell across the given column indices, so a genuinely ambiguous single-
 *  group amount (e.g. "1.234") in the same file can be resolved instead of
 *  guessed. Returns undefined when no convention could be established (no
 *  unambiguous signal, or conflicting signals across rows). */
function detectAmountConvention(
  table: CsvRow[],
  colIdx: number[],
): ',' | '.' | undefined {
  let found: ',' | '.' | undefined;
  for (let r = 1; r < table.length; r++) {
    if (table[r].malformed) continue;
    for (const idx of colIdx) {
      const raw = table[r].cells[idx];
      if (raw === undefined) continue;
      const a = analyzeAmount(raw);
      if (a.ambiguous || a.decimalChar === undefined) continue;
      if (found === undefined) found = a.decimalChar;
      else if (found !== a.decimalChar) return undefined; // conflicting signals
    }
  }
  return found;
}

/** Resolve one amount cell against the column's learned convention. */
function resolveAmountCell(
  raw: string,
  convention: ',' | '.' | undefined,
): { value: number | null; ambiguous: boolean } {
  const a = analyzeAmount(raw);
  if (a.canonical !== null) return { value: toNumber(a), ambiguous: false };
  if (a.ambiguous) {
    const resolved = resolveAmbiguous(a, convention);
    return resolved === null ? { value: null, ambiguous: true } : { value: resolved, ambiguous: false };
  }
  return { value: null, ambiguous: false };
}

export function parseStatementCsv(text: string): StatementParseResult {
  const table = splitCsvRows(normalizeStatementText(text));
  if (table.length === 0) return { entries: [], rows: [], rejected: [], headerFields: [] };

  const header = table[0].cells;
  const cols = detectColumns(header);
  const hasAmountSignal =
    cols.amount !== undefined || cols.debit !== undefined || cols.credit !== undefined;
  const canParseDeterministically =
    cols.date !== undefined && cols.description !== undefined && hasAmountSignal;

  const amountColIdx: number[] = [];
  if (cols.amount !== undefined) amountColIdx.push(cols.amount);
  if (cols.debit !== undefined) amountColIdx.push(cols.debit);
  if (cols.credit !== undefined) amountColIdx.push(cols.credit);
  const amountConvention = canParseDeterministically
    ? detectAmountConvention(table, amountColIdx)
    : undefined;

  const entries: StatementEntry[] = [];
  for (let r = 1; r < table.length; r++) {
    const sourceRow = r; // 1-based data row index, header excluded
    const cells = table[r].cells;
    const raw: Record<string, string> = {};
    header.forEach((h, idx) => {
      raw[h.trim() || `col${idx}`] = cells[idx] ?? '';
    });

    if (table[r].malformed) {
      entries.push({ sourceRow, ok: false, reason: 'malformed-quoting', raw });
      continue;
    }
    if (!canParseDeterministically) {
      entries.push({ sourceRow, ok: false, reason: 'needs-llm', raw });
      continue;
    }
    if (cells.length !== header.length) {
      entries.push({ sourceRow, ok: false, reason: 'column-mismatch', raw });
      continue;
    }

    const parsedDate = parseStatementDate(cells[cols.date as number] ?? '');
    if (!parsedDate) {
      entries.push({ sourceRow, ok: false, reason: 'invalid-date', raw });
      continue;
    }

    const description = (cells[cols.description as number] ?? '').trim();
    if (!description) {
      entries.push({ sourceRow, ok: false, reason: 'missing-description', raw });
      continue;
    }

    let signedAmount: number | null;
    let amountAmbiguous = false;
    if (cols.amount !== undefined) {
      const resolved = resolveAmountCell(cells[cols.amount] ?? '', amountConvention);
      signedAmount = resolved.value;
      amountAmbiguous = resolved.ambiguous;
    } else {
      const debitRaw = cols.debit !== undefined ? (cells[cols.debit] ?? '').trim() : '';
      const creditRaw = cols.credit !== undefined ? (cells[cols.credit] ?? '').trim() : '';
      if (debitRaw === '' && creditRaw === '') {
        signedAmount = null;
      } else {
        const debitR = debitRaw === '' ? { value: 0, ambiguous: false } : resolveAmountCell(debitRaw, amountConvention);
        const creditR = creditRaw === '' ? { value: 0, ambiguous: false } : resolveAmountCell(creditRaw, amountConvention);
        amountAmbiguous = debitR.ambiguous || creditR.ambiguous;
        signedAmount = debitR.value === null || creditR.value === null ? null : creditR.value - debitR.value;
      }
    }
    if (signedAmount === null || Number.isNaN(signedAmount)) {
      entries.push({
        sourceRow,
        ok: false,
        reason: amountAmbiguous ? 'ambiguous-amount' : 'invalid-amount',
        raw,
      });
      continue;
    }

    entries.push({
      sourceRow,
      ok: true,
      postedOn: parsedDate.iso,
      description,
      signedAmount: signedAmount.toFixed(2),
      currency: cols.currency !== undefined ? (cells[cols.currency] ?? '').trim() || null : null,
      counterparty:
        cols.counterparty !== undefined ? (cells[cols.counterparty] ?? '').trim() || null : null,
      category: cols.category !== undefined ? (cells[cols.category] ?? '').trim() || null : null,
      reference: cols.reference !== undefined ? (cells[cols.reference] ?? '').trim() || null : null,
      confidence: null, // deterministic path — confidence is an LLM-fallback concept (R5/WP5)
      warnings: parsedDate.ambiguous ? ['date-format-ambiguous-assumed-dmy'] : [],
      raw,
    });
  }

  const rows = entries.filter((e): e is StatementEntryOk => e.ok);
  const rejected = entries.filter((e): e is StatementEntryRejected => !e.ok);
  return { entries, rows, rejected, headerFields: Object.keys(cols) };
}
