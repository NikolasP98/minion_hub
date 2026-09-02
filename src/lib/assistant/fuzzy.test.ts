import { describe, expect, it } from 'vitest';
import { fuzzyFind, similarity } from './fuzzy';

const items = [
  { code: '1264', name: 'HA Saypha Volume' },
  { code: '1262', name: 'Hialuronidasa' },
  { code: 'JIEU', name: 'Jabón Íntimo Eudermic' },
  { code: '1256', name: 'Lidocaina (ml)' },
  { code: '1261', name: 'Acido Desoxicolico' },
];
const keys = (i: (typeof items)[number]) => [i.code, i.name];

describe('fuzzy', () => {
  it('resolves the prod typo hyaluronidasa → Hialuronidasa', () => {
    expect(fuzzyFind('hyaluronidasa', items, keys).match?.code).toBe('1262');
    expect(fuzzyFind('Hialuronidasa', items, keys).match?.code).toBe('1262');
    expect(fuzzyFind('1262', items, keys).match?.code).toBe('1262');
    expect(fuzzyFind('lidocaína', items, keys).match?.code).toBe('1256');
    expect(fuzzyFind('jabon intimo', items, keys).match?.code).toBe('JIEU');
  });
  it('does not guess on a miss but ranks nearest candidates first', () => {
    const r = fuzzyFind('botox', items, keys);
    expect(r.match).toBeNull();
    const r2 = fuzzyFind('acido', items, keys);
    expect(r2.match?.code).toBe('1261');
  });
  it('similarity is symmetric-ish and bounded', () => {
    expect(similarity('a', '')).toBe(0);
    expect(similarity('Hialuronidasa', 'hialuronidasa')).toBe(1);
    expect(similarity('hyaluronidasa', 'Hialuronidasa')).toBeGreaterThan(0.72);
  });
});
