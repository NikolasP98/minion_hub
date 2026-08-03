import { describe, it, expect } from 'vitest';
import {
  parseStatementCsv,
  parseStatementDate,
  parseStatementAmount,
  normalizeStatementText,
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
    expect(parseStatementCsv('')).toEqual({
      entries: [],
      rows: [],
      rejected: [],
      headerFields: [],
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
