import { describe, it, expect } from 'vitest';
import {
  parseStatementCsv,
  parseStatementDate,
  parseStatementAmount,
  normalizeStatementText,
  StatementParseLimitError,
  STATEMENT_LIMITS,
  STATEMENT_PARSER_VERSION,
} from './finance-statement-parser';

describe('normalizeStatementText', () => {
  it('collapses CRLF and bare CR to LF', () => {
    expect(normalizeStatementText('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });
});

describe('parseStatementDate', () => {
  it('parses ISO dates', () => {
    expect(parseStatementDate('2026-03-04')).toEqual({ iso: '2026-03-04', ambiguous: false });
  });
  it('resolves unambiguous DD/MM/YYYY (day > 12)', () => {
    expect(parseStatementDate('25/03/2026')).toEqual({ iso: '2026-03-25', ambiguous: false });
  });
  it('resolves unambiguous MM/DD/YYYY when the first slot cannot be a month', () => {
    expect(parseStatementDate('03/25/2026')).toEqual({ iso: '2026-03-25', ambiguous: false });
  });
  it('defaults genuinely ambiguous dates to DD/MM/YYYY and flags it', () => {
    expect(parseStatementDate('03/04/2026')).toEqual({ iso: '2026-04-03', ambiguous: true });
  });
  it('rejects invalid dates', () => {
    expect(parseStatementDate('2026-13-40')).toBeNull();
    expect(parseStatementDate('not a date')).toBeNull();
  });
});

describe('parseStatementAmount', () => {
  it('parses plain numbers', () => {
    expect(parseStatementAmount('123.45')).toBe(123.45);
    expect(parseStatementAmount('-123.45')).toBe(-123.45);
  });
  it('resolves EU format (dot thousands, comma decimal)', () => {
    expect(parseStatementAmount('1.234,56')).toBeCloseTo(1234.56);
  });
  it('resolves US format (comma thousands, dot decimal)', () => {
    expect(parseStatementAmount('1,234.56')).toBeCloseTo(1234.56);
  });
  it('treats a lone comma with 2 trailing digits as decimal', () => {
    expect(parseStatementAmount('45,90')).toBeCloseTo(45.9);
  });
  it('treats a lone dot with 1 trailing digit as decimal, not thousands (regression: was ×10)', () => {
    expect(parseStatementAmount('45.9')).toBeCloseTo(45.9);
  });
  it('treats a lone comma with 1 trailing digit as decimal', () => {
    expect(parseStatementAmount('45,9')).toBeCloseTo(45.9);
  });
  it('a lone separator with exactly 3 trailing digits is structurally ambiguous (thousands vs 3-decimal amount) — refuses to guess', () => {
    expect(parseStatementAmount('1.234')).toBeNull();
    expect(parseStatementAmount('45,900')).toBeNull();
  });
  it('resolves multi-group EU thousands unambiguously (2+ repeated 3-digit groups)', () => {
    expect(parseStatementAmount('12.345.678')).toBe(12345678);
  });
  it('resolves multi-group US thousands unambiguously (2+ repeated 3-digit groups)', () => {
    expect(parseStatementAmount('1,234,567')).toBe(1234567);
  });
  it('parses parenthesized amounts as negative', () => {
    expect(parseStatementAmount('(50.00)')).toBe(-50);
  });
  it('strips currency symbols', () => {
    expect(parseStatementAmount('S/ 100.00')).toBe(100);
    expect(parseStatementAmount('$1,000.00')).toBe(1000);
  });
  it('returns null for empty/unparseable input', () => {
    expect(parseStatementAmount('')).toBeNull();
    expect(parseStatementAmount('  ')).toBeNull();
  });
});

describe('parseStatementCsv', () => {
  it('parses a happy-path CSV with a single signed amount column', () => {
    const csv = [
      'Date,Description,Amount',
      '2026-01-05,Grocery store,-45.90',
      '2026-01-06,Salary,2500.00',
    ].join('\n');
    const result = parseStatementCsv(csv);
    expect(result.rows).toHaveLength(2);
    expect(result.rejected).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({
      sourceRow: 1,
      postedOn: '2026-01-05',
      description: 'Grocery store',
      signedAmount: '-45.90',
    });
    expect(result.rows[1].signedAmount).toBe('2500.00');
  });

  it('parses debit/credit columns into a signed amount (credit − debit)', () => {
    const csv = [
      'Fecha,Detalle,Cargo,Abono',
      '2026-01-05,Compra,45.90,',
      '2026-01-06,Deposito,,2500.00',
    ].join('\n');
    const result = parseStatementCsv(csv);
    expect(result.rejected).toHaveLength(0);
    expect(result.rows[0].signedAmount).toBe('-45.90');
    expect(result.rows[1].signedAmount).toBe('2500.00');
  });

  it('handles CRLF line endings identically to LF', () => {
    const csv = ['Date,Description,Amount', '2026-01-05,Grocery store,-45.90'].join('\r\n');
    const result = parseStatementCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].description).toBe('Grocery store');
  });

  it('rejects rows with an invalid date, keeping other rows intact', () => {
    const csv = [
      'Date,Description,Amount',
      'not-a-date,Grocery store,-45.90',
      '2026-01-06,Salary,2500.00',
    ].join('\n');
    const result = parseStatementCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({ sourceRow: 1, reason: 'invalid-date' });
  });

  it('rejects rows with an invalid/blank amount', () => {
    const csv = ['Date,Description,Amount', '2026-01-05,Grocery store,not-a-number'].join('\n');
    const result = parseStatementCsv(csv);
    expect(result.rejected[0].reason).toBe('invalid-amount');
  });

  it('rejects rows with a missing description', () => {
    const csv = ['Date,Description,Amount', '2026-01-05,,-45.90'].join('\n');
    const result = parseStatementCsv(csv);
    expect(result.rejected[0].reason).toBe('missing-description');
  });

  it('rejects every data row with needs-llm when columns cannot be confidently mapped', () => {
    const csv = ['Col A,Col B,Col C', 'x,y,z', 'a,b,c'].join('\n');
    const result = parseStatementCsv(csv);
    expect(result.rows).toHaveLength(0);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected.every((r) => r.reason === 'needs-llm')).toBe(true);
  });

  it('every input data row lands in exactly one of rows/rejected', () => {
    const csv = [
      'Date,Description,Amount',
      '2026-01-05,Grocery store,-45.90',
      'bad-date,Something,10.00',
      '2026-01-06,,5.00',
      '2026-01-07,Salary,2500.00',
    ].join('\n');
    const result = parseStatementCsv(csv);
    expect(result.rows.length + result.rejected.length).toBe(4);
    expect(result.entries).toHaveLength(4);
    const sourceRows = result.entries.map((e) => e.sourceRow).sort((a, b) => a - b);
    expect(sourceRows).toEqual([1, 2, 3, 4]);
  });

  it('handles quoted fields with embedded commas', () => {
    const csv = ['Date,Description,Amount', '2026-01-05,"Grocery, downtown",-45.90'].join('\n');
    const result = parseStatementCsv(csv);
    expect(result.rows[0].description).toBe('Grocery, downtown');
  });

  it('returns empty result for empty input', () => {
    const result = parseStatementCsv('');
    expect(result).toMatchObject({ entries: [], rows: [], rejected: [], headerFields: [] });
    // Provenance is still emitted — an empty parse is a parse.
    expect(result.provenance).toMatchObject({
      parserVersion: STATEMENT_PARSER_VERSION,
      sourceChars: 0,
      dataRows: 0,
    });
  });

  it('resolves an otherwise-ambiguous single-group amount using the column-wide decimal convention established by another row', () => {
    // Row 1's amount unambiguously reveals the file uses ',' as the decimal
    // separator (two-separator case) — so row 2's lone "1.234" must be
    // thousands grouping (1234), not a 3-decimal amount.
    const csv = [
      'Date,Description,Amount',
      '2026-01-05,Big purchase,"1.234,56"',
      '2026-01-06,Small charge,1.234',
    ].join('\n');
    const result = parseStatementCsv(csv);
    expect(result.rejected).toHaveLength(0);
    expect(result.rows[0].signedAmount).toBe('1234.56');
    expect(result.rows[1].signedAmount).toBe('1234.00');
  });

  it('rejects an ambiguous amount with reason ambiguous-amount when the file gives no column-wide convention to resolve it', () => {
    const csv = ['Date,Description,Amount', '2026-01-05,Something,1.234'].join('\n');
    const result = parseStatementCsv(csv);
    expect(result.rows).toHaveLength(0);
    expect(result.rejected[0].reason).toBe('ambiguous-amount');
  });

  it('rejects a quote opened mid-field (not at field start) as malformed-quoting', () => {
    const csv = ['Date,Description,Amount', '2026-01-05,Grocer"oops,-45.90'].join('\n');
    const result = parseStatementCsv(csv);
    expect(result.rows).toHaveLength(0);
    expect(result.rejected[0].reason).toBe('malformed-quoting');
  });

  it('rejects text trailing a closed quote as malformed-quoting', () => {
    const csv = ['Date,Description,Amount', '2026-01-05,"Grocer"oops,-45.90'].join('\n');
    const result = parseStatementCsv(csv);
    expect(result.rows).toHaveLength(0);
    expect(result.rejected[0].reason).toBe('malformed-quoting');
  });

  it('rejects an unterminated quote at EOF as malformed-quoting', () => {
    const csv = ['Date,Description,Amount', '2026-01-05,"Grocery store,-45.90'].join('\n');
    const result = parseStatementCsv(csv);
    expect(result.rows).toHaveLength(0);
    expect(result.rejected[0].reason).toBe('malformed-quoting');
  });

  it('still accepts a valid escaped "" inside a quoted field', () => {
    const csv = ['Date,Description,Amount', '2026-01-05,"Grocer""s store",-45.90'].join('\n');
    const result = parseStatementCsv(csv);
    expect(result.rejected).toHaveLength(0);
    expect(result.rows[0].description).toBe('Grocer"s store');
  });
});

// ── DATA-01: provenance and enforced bounds ────────────────────────────────

const HEADER = 'Date,Description,Amount';
const csv = (...rows: string[]) => [HEADER, ...rows].join('\n');

describe('parse provenance (DATA-01)', () => {
  it('identifies the parser and the exact normalized text it parsed', () => {
    const result = parseStatementCsv(csv('2026-03-04,Coffee,-4.50'));
    expect(result.provenance.parserVersion).toBe(STATEMENT_PARSER_VERSION);
    expect(result.provenance.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.provenance.dataRows).toBe(1);
    expect(result.provenance.sourceChars).toBe(csv('2026-03-04,Coffee,-4.50').length);
  });

  it('is deterministic for identical content and differs for different content', () => {
    const a = parseStatementCsv(csv('2026-03-04,Coffee,-4.50')).provenance.sourceSha256;
    const b = parseStatementCsv(csv('2026-03-04,Coffee,-4.50')).provenance.sourceSha256;
    const c = parseStatementCsv(csv('2026-03-04,Coffee,-4.51')).provenance.sourceSha256;
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('hashes the NORMALIZED text, so CRLF and LF of the same statement agree', () => {
    const lf = parseStatementCsv(csv('2026-03-04,Coffee,-4.50'));
    const crlf = parseStatementCsv(csv('2026-03-04,Coffee,-4.50').replace(/\n/g, '\r\n'));
    expect(crlf.provenance.sourceSha256).toBe(lf.provenance.sourceSha256);
    expect(crlf.rows).toEqual(lf.rows);
  });

  it('counts every data row as accepted or rejected, never dropped', () => {
    const result = parseStatementCsv(
      csv('2026-03-04,Coffee,-4.50', '2026-13-40,Bad date,-1.00', 'not,a,row'),
    );
    expect(result.entries.length).toBe(3);
    expect(result.rows.length + result.rejected.length).toBe(result.entries.length);
    expect(result.provenance.dataRows).toBe(3);
  });
});

describe('bounded ingestion (DATA-01)', () => {
  it('throws a traceable limit error for oversized input instead of parsing it', () => {
    const huge = 'x'.repeat(STATEMENT_LIMITS.maxInputChars + 1);
    expect(() => parseStatementCsv(huge)).toThrow(StatementParseLimitError);
    try {
      parseStatementCsv(huge);
      expect.unreachable();
    } catch (e) {
      const err = e as StatementParseLimitError;
      expect(err.reason).toBe('input-too-large');
      expect(err.limit).toBe(STATEMENT_LIMITS.maxInputChars);
      expect(err.actual).toBe(huge.length);
      // The message must stay bounded and content-free — it is persisted on
      // the import row and surfaced to the operator.
      expect(err.message.length).toBeLessThan(120);
      expect(err.message).not.toContain('x'.repeat(20));
    }
  });

  it('throws once the data-row limit is passed, without materializing the rest', () => {
    const rows = Array.from(
      { length: STATEMENT_LIMITS.maxDataRows + 5 },
      () => '2026-03-04,Coffee,-4.50',
    );
    try {
      parseStatementCsv(csv(...rows));
      expect.unreachable();
    } catch (e) {
      const err = e as StatementParseLimitError;
      expect(err).toBeInstanceOf(StatementParseLimitError);
      expect(err.reason).toBe('too-many-rows');
      expect(err.limit).toBe(STATEMENT_LIMITS.maxDataRows);
    }
  });

  it('accepts a statement exactly at the row limit', () => {
    const rows = Array.from(
      { length: STATEMENT_LIMITS.maxDataRows },
      (_, i) => `2026-03-04,Row ${i},-1.00`,
    );
    const result = parseStatementCsv(csv(...rows));
    expect(result.entries.length).toBe(STATEMENT_LIMITS.maxDataRows);
    expect(result.rows.length).toBe(STATEMENT_LIMITS.maxDataRows);
  });

  it('rejects one oversized record and keeps the rest of the statement', () => {
    const big = 'y'.repeat(STATEMENT_LIMITS.maxFieldChars + 10);
    const result = parseStatementCsv(
      csv('2026-03-04,Coffee,-4.50', `2026-03-05,${big},-9.99`, '2026-03-06,Bus,-2.00'),
    );
    expect(result.rejected.map((r) => [r.sourceRow, r.reason])).toEqual([[2, 'record-too-large']]);
    expect(result.rows.map((r) => r.description)).toEqual(['Coffee', 'Bus']);
    // The rejected record's raw values are retained but bounded.
    const raw = JSON.stringify(result.rejected[0].raw);
    expect(raw.length).toBeLessThan(STATEMENT_LIMITS.maxFieldChars + 200);
  });

  it('rejects a record with more columns than the limit', () => {
    const wide = Array.from({ length: STATEMENT_LIMITS.maxColumns + 5 }, () => 'v').join(',');
    const result = parseStatementCsv(csv('2026-03-04,Coffee,-4.50', wide));
    expect(result.rejected.map((r) => r.reason)).toEqual(['record-too-large']);
    expect(result.rows.length).toBe(1);
  });

  it('rejects a record whose bytes failed to decode, with its raw preserved', () => {
    const result = parseStatementCsv(csv('2026-03-04,Caf\uFFFD,-4.50', '2026-03-05,Clean,-1.00'));
    expect(result.rejected.map((r) => [r.sourceRow, r.reason])).toEqual([[1, 'invalid-encoding']]);
    expect(result.rejected[0].raw.Description).toBe('Caf\uFFFD');
    expect(result.rows.map((r) => r.description)).toEqual(['Clean']);
  });

  it('does not coerce an ambiguous amount or date into a fabricated default', () => {
    // No unambiguous amount anywhere in the file, so "1.234" has no column
    // convention to resolve against — it must stay rejected, not become 1234.
    const result = parseStatementCsv(csv('2026-03-04,Coffee,1.234', 'nope,Bus,5.678'));
    expect(result.rejected.map((r) => r.reason)).toEqual(['ambiguous-amount', 'invalid-date']);
    expect(result.rows).toEqual([]);
  });

  it('keeps duplicate transactions accepted but traceable to the first row', () => {
    const result = parseStatementCsv(
      csv('2026-03-04,Coffee,-4.50', '2026-03-04,Coffee,-4.50', '2026-03-04,Coffee,-4.51'),
    );
    expect(result.rows.length).toBe(3);
    expect(result.rows[0].warnings).toEqual([]);
    expect(result.rows[1].warnings).toEqual(['duplicate-of-row-1']);
    expect(result.rows[2].warnings).toEqual([]);
    // Financial meaning is preserved — a duplicate is still money.
    expect(result.rows.map((r) => r.signedAmount)).toEqual(['-4.50', '-4.50', '-4.51']);
  });

  it('keeps quoted multiline fields and the ambiguous-date warning intact', () => {
    const result = parseStatementCsv(csv('03/04/2026,"Grocer\nSt 5",-4.50'));
    expect(result.rows[0].description).toBe('Grocer\nSt 5');
    expect(result.rows[0].postedOn).toBe('2026-04-03');
    expect(result.rows[0].warnings).toEqual(['date-format-ambiguous-assumed-dmy']);
  });
});
