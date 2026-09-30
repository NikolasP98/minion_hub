import { describe, expect, it } from 'vitest';
import { toTsv, toHtmlTable, parseTsv } from './clipboard';

describe('toTsv', () => {
  it('joins cells with tabs and rows with newlines', () => {
    expect(
      toTsv([
        ['a', 'b'],
        ['c', 'd'],
      ]),
    ).toBe('a\tb\nc\td');
  });

  it('quotes a cell containing a tab, newline, or quote', () => {
    expect(toTsv([['has\ttab', 'has\nnewline', 'has"quote']])).toBe(
      '"has\ttab"\t"has\nnewline"\t"has""quote"',
    );
  });

  it('round-trips through parseTsv', () => {
    const rows = [
      ['plain', 'with\ttab', 'with"quote'],
      ['second', 'row', 'here'],
    ];
    expect(parseTsv(toTsv(rows))).toEqual(rows);
  });
});

describe('toHtmlTable', () => {
  it('produces a plain table with escaped cells', () => {
    expect(toHtmlTable([['<b>', 'a & b']])).toBe(
      '<table><tr><td>&lt;b&gt;</td><td>a &amp; b</td></tr></table>',
    );
  });
});

describe('parseTsv', () => {
  it('parses a simple grid', () => {
    expect(parseTsv('a\tb\nc\td')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('drops a single trailing blank line', () => {
    expect(parseTsv('a\tb\n')).toEqual([['a', 'b']]);
  });

  it('handles a single value with no tabs/newlines', () => {
    expect(parseTsv('42')).toEqual([['42']]);
  });

  it('unescapes doubled quotes inside a quoted cell', () => {
    expect(parseTsv('"say ""hi"""\tplain')).toEqual([['say "hi"', 'plain']]);
  });

  it('handles CRLF line endings (Excel/Windows clipboard)', () => {
    expect(parseTsv('a\tb\r\nc\td')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});
