import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assertInterval, ControlAccumulator, intervalContained, isRealDate } from './audit.logic';

describe('audit dates and intervals', () => {
  it.each([
    ['2026-02-28', true],
    ['2024-02-29', true],
    ['2026-02-30', false],
    ['2026-13-01', false],
    ['01/02/2026', false],
    ['2026-2-1', false],
  ])('isRealDate(%s)=%s', (value, expected) => expect(isRealDate(value)).toBe(expected));

  it('rejects equal or inverted finite bounds and impossible dates', () => {
    expect(() => assertInterval({ after: '2026-05-01', before: '2026-05-01' }, 'u')).toThrow();
    expect(() => assertInterval({ after: '2026-05-02', before: '2026-05-01' }, 'u')).toThrow();
    expect(() => assertInterval({ after: '2026-02-30', before: null }, 'u')).toThrow();
    expect(() => assertInterval({ after: '2026-05-01', before: '2026-05-02' }, 'u')).not.toThrow();
    expect(() => assertInterval({ after: null, before: null }, 'u')).not.toThrow();
  });

  it('allows a same-day cohort [D, D+1) and refuses widening', () => {
    const approved = { after: '2026-05-01', before: '2026-06-01' };
    expect(intervalContained({ after: '2026-05-10', before: '2026-05-11' }, approved)).toBe(true);
    expect(intervalContained({ after: '2026-04-30', before: '2026-05-11' }, approved)).toBe(false);
    expect(intervalContained({ after: null, before: '2026-05-11' }, approved)).toBe(false);
    expect(intervalContained({ after: '2026-05-10', before: null }, approved)).toBe(false);
    expect(intervalContained({ after: null, before: null }, { after: null, before: null })).toBe(
      true,
    );
    expect(
      intervalContained({ after: '2026-05-10', before: null }, { after: null, before: null }),
    ).toBe(true);
  });
});

describe('ControlAccumulator', () => {
  it('counts rows, splits cohort and complement, samples 100 ids and hashes in order', () => {
    const ids = Array.from({ length: 150 }, (_, i) => `id-${String(i).padStart(4, '0')}`);
    const acc = new ControlAccumulator();
    ids.forEach((id, i) => acc.add(id, i % 3 === 0));
    const control = acc.finish();
    expect(control.count).toBe(150);
    expect(control.cohortCount).toBe(50);
    expect(control.complementCount).toBe(100);
    expect(control.sampleIds).toEqual(ids.slice(0, 100));
    expect(control.idsSha256).toBe(createHash('sha256').update(ids.join('\n')).digest('hex'));
  });

  it('hashes an empty control as the empty digest and rejects unordered input', () => {
    expect(new ControlAccumulator().finish().idsSha256).toBe(
      createHash('sha256').update('').digest('hex'),
    );
    const acc = new ControlAccumulator();
    acc.add('b', true);
    expect(() => acc.add('a', true)).toThrow(/ascending/);
    expect(() => acc.add('b', true)).toThrow(/ascending/);
  });
});
