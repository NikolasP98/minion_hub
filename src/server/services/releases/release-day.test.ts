import { describe, expect, it } from 'vitest';
import { groupReleasesByDay, releaseDayKey } from './release-day';

const row = (
  id: string,
  version: string,
  releasedAt: string,
  sections: Record<string, Record<string, string[]>>,
  prs: number[],
) => ({
  id,
  version,
  releasedAt,
  sections,
  prs: prs.map((n) => ({ number: n, title: `t${n}`, url: `https://x.invalid/pull/${n}` })),
});

describe('releaseDayKey', () => {
  it('strips the same-day push suffix only', () => {
    expect(releaseDayKey('hub-v2026.10.15-4')).toBe('hub-v2026.10.15');
    expect(releaseDayKey('hub-v2026.10.15')).toBe('hub-v2026.10.15');
    expect(releaseDayKey('hub-v2026.10.15-12')).toBe('hub-v2026.10.15');
  });
});

describe('groupReleasesByDay', () => {
  it('folds a day of pushes into one entry, newest first, PRs deduped, latest time kept', () => {
    const grouped = groupReleasesByDay([
      row('d', 'hub-v2026.10.15-2', '2026-10-15T03:00:00Z', { Arreglado: { pos: ['b'] } }, [523]),
      row('c', 'hub-v2026.10.15-1', '2026-10-15T02:00:00Z', { Nuevo: { pos: ['a'] } }, [522]),
      row('b', 'hub-v2026.10.15', '2026-10-15T01:00:00Z', { Interno: { skill: ['s'] } }, [521]),
      row('a', 'hub-v2026.10.14-1', '2026-10-14T20:00:00Z', { Nuevo: { inbox: ['i'] } }, [520]),
    ]);
    expect(grouped.map((r) => r.version)).toEqual(['hub-v2026.10.15', 'hub-v2026.10.14']);
    const day = grouped[0];
    expect(day.id).toBe('d');
    expect(day.releasedAt).toBe('2026-10-15T03:00:00Z');
    expect(day.sections).toEqual({
      Arreglado: { pos: ['b'] },
      Nuevo: { pos: ['a'] },
      Interno: { skill: ['s'] },
    });
    expect(day.prs.map((p) => p.number)).toEqual([523, 522, 521]);
  });

  it('appends same label/scope lines and ignores an exact duplicate line', () => {
    const [day] = groupReleasesByDay([
      row('b', 'hub-v2026.10.15-1', '2026-10-15T02:00:00Z', { Nuevo: { pos: ['x'] } }, [2]),
      row('a', 'hub-v2026.10.15', '2026-10-15T01:00:00Z', { Nuevo: { pos: ['y', 'x'] } }, [1, 2]),
    ]);
    expect(day.sections).toEqual({ Nuevo: { pos: ['x', 'y'] } });
    expect(day.prs.map((p) => p.number)).toEqual([2, 1]);
  });

  it('never mutates the input rows', () => {
    const input = [
      row('b', 'hub-v2026.10.15-1', '2026-10-15T02:00:00Z', { Nuevo: { pos: ['x'] } }, [2]),
      row('a', 'hub-v2026.10.15', '2026-10-15T01:00:00Z', { Nuevo: { pos: ['y'] } }, [1]),
    ];
    const snapshot = JSON.stringify(input);
    groupReleasesByDay(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
