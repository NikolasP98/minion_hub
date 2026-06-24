import { describe, it, expect } from 'vitest';
import { toCsv, toXlsx } from './table-export';

describe('table-export', () => {
  it('escapes CSV fields with commas, quotes, newlines', () => {
    const csv = toCsv([
      ['Name', 'Note'],
      ['Plain', 'no special'],
      ['Quote "x"', 'a,b'],
      ['Line\nbreak', 42],
    ]);
    expect(csv).toBe('Name,Note\r\nPlain,no special\r\n"Quote ""x""","a,b"\r\n"Line\nbreak",42');
  });

  it('produces a parseable ZIP container for XLSX', () => {
    const bytes = toXlsx([
      ['A', 'B'],
      ['x', 1],
    ]);
    // Local file header magic + central directory present => valid stored zip.
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const hasCentral = (() => {
      for (let i = 0; i < bytes.length - 4; i++)
        if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x01 && bytes[i + 3] === 0x02) return true;
      return false;
    })();
    expect(hasCentral).toBe(true);
    // Sheet XML carries the inline string + numeric cell.
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('<t xml:space="preserve">x</t>');
    expect(text).toContain('<v>1</v>');
  });
});
