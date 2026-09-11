/**
 * Deterministic bank-statement CSV/text parser (WP4, R5 — no LLM in this
 * wave). Pure functions, no I/O — testable in isolation and safe to call
 * repeatedly for the same content (used by the resumable bg-runtime chunker).
 *
 * Contract: every input data row lands in exactly one of `rows` (accepted) or
 * `rejected` (with a reason). Ambiguous column mapping (can't confidently find
 * date+description+amount) rejects EVERY data row with reason 'needs-llm' —
 * the gateway drone fallback is a later cross-repo wave (R5/WP5).
 *
 * DATA-01: every result carries its own provenance (parser version + sha-256
 * of the exact normalized text that was parsed), and the work is bounded.
 * Whole-input limits (characters, data rows) throw `StatementParseLimitError` —
 * there is no row to attach them to and continuing would be unbounded memory.
 * Invalid headers throw a content-free `StatementParseHeaderError` before mapping.
 * Per-data-record limits reject that record and keep its raw values, so a single
 * oversized or badly-encoded line never discards the rest of the statement.
 * Nothing ambiguous is coerced to a default: it is rejected with a reason.
 */
import { createHash } from 'node:crypto';

/**
 * Bump whenever accepted/rejected semantics change — a stored parse is only
 * reproducible against the version that produced it.
 * v2: bounded input/record work, invalid-encoding and duplicate detection.
 * v3: reject unusable headers and count data records after excluding genuine blanks.
 *
 * TODO(handoff): `finance-statements.service.ts` keeps its own PARSER_VERSION
 * (still 1) and writes it to fin_statement_imports.parser_version. That file is
 * owned by the frozen 10-04 candidate (see .planning/phases/10-durable-jobs-stock/
 * 10-04-SUMMARY.md), which is not on master, so it is deliberately untouched
 * here. Whoever lands 10-04 must source the stored version from
 * STATEMENT_PARSER_VERSION and invalidate cursors whose stored version differs;
 * see proposals/2026-09-10-hub-finance-parser-version-binding.md.
 */
export const STATEMENT_PARSER_VERSION = 3;

/**
 * Enforced limits. Deliberately generous relative to a real bank statement
 * (a year of daily transactions is ~400 rows) — these bound a hostile or
 * corrupt upload, they are not a business policy on statement size.
 */
export const STATEMENT_LIMITS = {
  /** Whole input, in UTF-16 code units. ~8 MB of ASCII. Throws. */
  maxInputChars: 8_000_000,
  /** Data rows excluding the header. Throws. */
  maxDataRows: 100_000,
  /** One field's characters. Rejects the record. */
  maxFieldChars: 4_096,
  /** Columns per record. Rejects the record. */
  maxColumns: 256,
} as const;

/** Whole-input limit breach — no single record owns it, so it is thrown. */
export class StatementParseLimitError extends Error {
  readonly code = 'statement_limit_exceeded';
  constructor(
    readonly reason: 'input-too-large' | 'too-many-rows',
    readonly limit: number,
    readonly actual: number,
  ) {
    super(`${reason}: ${actual} exceeds the enforced limit of ${limit}`);
    this.name = 'StatementParseLimitError';
  }
}

/** An unusable header cannot assign trustworthy meaning to any data row.
 * Only a fixed reason is exposed: never echo a header containing customer data. */
export class StatementParseHeaderError extends Error {
  readonly code = 'statement_header_invalid';
  constructor(readonly reason: 'record-too-large' | 'malformed-quoting' | 'invalid-encoding') {
    super(`Invalid statement header: ${reason}`);
    this.name = 'StatementParseHeaderError';
  }
}

/** Deterministic identity of the exact text this result was produced from. */
export interface StatementParseProvenance {
  parserVersion: number;
  /** sha-256 of the NORMALIZED text actually parsed (CRLF/CR already folded). */
  sourceSha256: string;
  sourceChars: number;
  dataRows: number;
}

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
  /** DATA-01: which parser, and which exact bytes, produced this result. */
  provenance: StatementParseProvenance;
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
  /** A field or the column count exceeded its enforced limit. Cells are
   *  truncated to keep memory bounded — reject the record, don't trust them. */
  oversized: boolean;
}

// ── CSV tokenizer (minimal RFC4180: quoted fields, "" escape, embedded commas/newlines) ──
function splitCsvRows(text: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldStarted = false; // has any char landed in the current field yet?
  let rowMalformed = false;
  let rowOversized = false;
  let sawAny = false;

  const endField = () => {
    // Column overflow drops the surplus cell rather than growing the row: the
    // record is already rejected, and an unbounded column count is the whole
    // point of the limit.
    if (row.length >= STATEMENT_LIMITS.maxColumns) rowOversized = true;
    else row.push(field);
    field = '';
    fieldStarted = false;
  };
  const endRow = () => {
    endField();
    // Match the existing logical-row convention, but discard genuine blanks
    // before allocating/counting them. Malformed or truncated empty-looking
    // records remain evidence and consume capacity like any other data record.
    const blank = row.length === 1 && row[0].trim() === '' && !rowMalformed && !rowOversized;
    if (!blank) {
      if (rows.length === 0) {
        // The first nonblank row owns the column mapping. Truncated characters
        // or columns are never trusted, even if a dropped suffix hid U+FFFD.
        if (rowOversized) throw new StatementParseHeaderError('record-too-large');
        if (rowMalformed) throw new StatementParseHeaderError('malformed-quoting');
        if (row.some((cell) => cell.includes(REPLACEMENT_CHAR))) {
          throw new StatementParseHeaderError('invalid-encoding');
        }
      }
      rows.push({ cells: row, malformed: rowMalformed, oversized: rowOversized });
      // +1 for the validated header; rejected data records count too.
      if (rows.length > STATEMENT_LIMITS.maxDataRows + 1) {
        throw new StatementParseLimitError(
          'too-many-rows',
          STATEMENT_LIMITS.maxDataRows,
          rows.length - 1,
        );
      }
    }
    row = [];
    rowMalformed = false;
    rowOversized = false;
    sawAny = false;
  };

  /** Bounded field append — past the limit characters are dropped, not stored. */
  const push = (c: string) => {
    if (field.length >= STATEMENT_LIMITS.maxFieldChars) rowOversized = true;
    else field += c;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          push('"');
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
        push(c);
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
      push(c);
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
    push(c);
    fieldStarted = true;
    sawAny = true;
  }
  if (inQuotes) rowMalformed = true; // unterminated quote at EOF
  if (sawAny || field.length > 0 || row.length > 0) {
    endRow();
  }
  return rows;
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
    const canonical = commaIsDecimal ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
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
function detectAmountConvention(table: CsvRow[], colIdx: number[]): ',' | '.' | undefined {
  let found: ',' | '.' | undefined;
  for (let r = 1; r < table.length; r++) {
    if (table[r].malformed || table[r].oversized) continue;
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
    return resolved === null
      ? { value: null, ambiguous: true }
      : { value: resolved, ambiguous: false };
  }
  return { value: null, ambiguous: false };
}

/** U+FFFD only appears when a decode already failed — the original bytes are
 *  gone, so the cell's financial meaning cannot be recovered. Reject, keep raw. */
const REPLACEMENT_CHAR = '\uFFFD';

export function parseStatementCsv(text: string): StatementParseResult {
  const normalized = normalizeStatementText(text);
  if (normalized.length > STATEMENT_LIMITS.maxInputChars) {
    throw new StatementParseLimitError(
      'input-too-large',
      STATEMENT_LIMITS.maxInputChars,
      normalized.length,
    );
  }
  const provenanceOf = (dataRows: number): StatementParseProvenance => ({
    parserVersion: STATEMENT_PARSER_VERSION,
    sourceSha256: createHash('sha256').update(normalized, 'utf8').digest('hex'),
    sourceChars: normalized.length,
    dataRows,
  });

  const table = splitCsvRows(normalized);
  if (table.length === 0)
    return { entries: [], rows: [], rejected: [], headerFields: [], provenance: provenanceOf(0) };

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
  const seen = new Map<string, number>();
  for (let r = 1; r < table.length; r++) {
    const sourceRow = r; // 1-based data row index, header excluded
    const cells = table[r].cells;
    const raw: Record<string, string> = {};
    header.forEach((h, idx) => {
      raw[h.trim() || `col${idx}`] = cells[idx] ?? '';
    });

    if (table[r].oversized) {
      entries.push({ sourceRow, ok: false, reason: 'record-too-large', raw });
      continue;
    }
    if (table[r].malformed) {
      entries.push({ sourceRow, ok: false, reason: 'malformed-quoting', raw });
      continue;
    }
    if (cells.some((c) => c.includes(REPLACEMENT_CHAR))) {
      entries.push({ sourceRow, ok: false, reason: 'invalid-encoding', raw });
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
        const debitR =
          debitRaw === ''
            ? { value: 0, ambiguous: false }
            : resolveAmountCell(debitRaw, amountConvention);
        const creditR =
          creditRaw === ''
            ? { value: 0, ambiguous: false }
            : resolveAmountCell(creditRaw, amountConvention);
        amountAmbiguous = debitR.ambiguous || creditR.ambiguous;
        signedAmount =
          debitR.value === null || creditR.value === null ? null : creditR.value - debitR.value;
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

    // Identical transactions are legitimate on a real statement (two coffees on
    // one day), so they stay ACCEPTED — the warning makes the repeat traceable
    // without a policy decision the parser has no authority to make.
    const fixedAmount = signedAmount.toFixed(2);
    const dupeKey = `${parsedDate.iso}|${description}|${fixedAmount}`;
    const firstSeen = seen.get(dupeKey);
    if (firstSeen === undefined) seen.set(dupeKey, sourceRow);

    entries.push({
      sourceRow,
      ok: true,
      postedOn: parsedDate.iso,
      description,
      signedAmount: fixedAmount,
      currency: cols.currency !== undefined ? (cells[cols.currency] ?? '').trim() || null : null,
      counterparty:
        cols.counterparty !== undefined ? (cells[cols.counterparty] ?? '').trim() || null : null,
      category: cols.category !== undefined ? (cells[cols.category] ?? '').trim() || null : null,
      reference: cols.reference !== undefined ? (cells[cols.reference] ?? '').trim() || null : null,
      confidence: null, // deterministic path — confidence is an LLM-fallback concept (R5/WP5)
      warnings: [
        ...(parsedDate.ambiguous ? ['date-format-ambiguous-assumed-dmy'] : []),
        ...(firstSeen === undefined ? [] : [`duplicate-of-row-${firstSeen}`]),
      ],
      raw,
    });
  }

  const rows = entries.filter((e): e is StatementEntryOk => e.ok);
  const rejected = entries.filter((e): e is StatementEntryRejected => !e.ok);
  return {
    entries,
    rows,
    rejected,
    headerFields: Object.keys(cols),
    provenance: provenanceOf(entries.length),
  };
}
