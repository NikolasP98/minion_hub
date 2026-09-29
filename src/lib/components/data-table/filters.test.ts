import { describe, expect, it } from 'vitest';
import {
  defaultOp,
  emptyFilter,
  emptyGroup,
  emptyRule,
  filterToParam,
  isFilterActive,
  matchesFilter,
  matchesGroup,
  opNeedsOperand,
  opsFor,
  relativeWindow,
  type FilterGroup,
  type FilterValue,
} from './filters';

// Pinned "now" so relative-date windows are deterministic: a Wednesday.
const NOW = new Date(2026, 8, 30, 10, 0, 0); // 2026-09-30 (Wed), local time

describe('isFilterActive', () => {
  it('treats an empty selection, blank text and an unbounded range as inert', () => {
    expect(isFilterActive(null)).toBe(false);
    expect(isFilterActive({ kind: 'enum', values: [] })).toBe(false);
    expect(isFilterActive({ kind: 'text', text: '   ' })).toBe(false);
    expect(isFilterActive({ kind: 'number', min: null, max: null })).toBe(false);
    expect(isFilterActive({ kind: 'number', min: 0, max: null })).toBe(true);
    expect(isFilterActive({ kind: 'date', min: null, max: '2026-01-01' })).toBe(true);
  });

  it('emptyFilter round-trips to inert for every non-boolean kind; boolean is always active', () => {
    for (const kind of ['enum', 'text', 'number', 'date'] as const)
      expect(isFilterActive(emptyFilter(kind))).toBe(false);
    expect(isFilterActive(emptyFilter('boolean'))).toBe(true);
  });

  it('is_empty / is_not_empty are active with no operand, on every kind that has them', () => {
    expect(isFilterActive({ kind: 'text', op: 'is_empty', text: '' })).toBe(true);
    expect(isFilterActive({ kind: 'number', op: 'is_not_empty', min: null, max: null })).toBe(true);
    expect(isFilterActive({ kind: 'date', op: 'is_empty', min: null, max: null })).toBe(true);
    expect(isFilterActive({ kind: 'enum', op: 'is_not_empty', values: [] })).toBe(true);
  });

  it('a relative date is active only once a window is picked', () => {
    expect(isFilterActive({ kind: 'date', op: 'relative', min: null, max: null })).toBe(false);
    expect(
      isFilterActive({ kind: 'date', op: 'relative', min: null, max: null, rel: 'today' }),
    ).toBe(true);
  });

  it('a single-operand op reads its operand from min', () => {
    expect(isFilterActive({ kind: 'number', op: 'gt', min: null, max: null })).toBe(false);
    expect(isFilterActive({ kind: 'number', op: 'gt', min: 5, max: null })).toBe(true);
    expect(isFilterActive({ kind: 'date', op: 'before', min: null, max: null })).toBe(false);
    expect(isFilterActive({ kind: 'date', op: 'before', min: '2026-01-01', max: null })).toBe(true);
  });
});

describe('defaultOp / opsFor / opNeedsOperand', () => {
  it('every kind has a default op that is a member of its own op list', () => {
    for (const kind of ['enum', 'text', 'number', 'date', 'boolean'] as const) {
      expect(opsFor(kind)).toContain(defaultOp(kind));
    }
  });

  it('boolean never needs an operand; is_empty/is_not_empty never need one; everything else does', () => {
    expect(opNeedsOperand('boolean', 'checked')).toBe(false);
    expect(opNeedsOperand('boolean', 'unchecked')).toBe(false);
    expect(opNeedsOperand('text', 'is_empty')).toBe(false);
    expect(opNeedsOperand('number', 'is_not_empty')).toBe(false);
    expect(opNeedsOperand('text', 'contains')).toBe(true);
    expect(opNeedsOperand('date', 'relative')).toBe(true);
    expect(opNeedsOperand('number', 'between')).toBe(true);
  });
});

describe('matchesFilter — legacy literals (no op)', () => {
  it('an inert filter matches everything', () => {
    expect(matchesFilter({ kind: 'text', text: '' }, 'anything')).toBe(true);
  });

  it('enum matches any of a row’s values', () => {
    const f: FilterValue = { kind: 'enum', values: ['a', 'b'] };
    expect(matchesFilter(f, 'a')).toBe(true);
    expect(matchesFilter(f, ['z', 'b'])).toBe(true);
    expect(matchesFilter(f, 'c')).toBe(false);
    expect(matchesFilter(f, null)).toBe(false);
  });

  it('text is a case-insensitive contains', () => {
    const f = { kind: 'text', text: ' LiP ' } as const;
    expect(matchesFilter(f, 'Relleno de labios / lip')).toBe(true);
    expect(matchesFilter(f, 'botox')).toBe(false);
  });

  it('number and date ranges include BOTH endpoints', () => {
    const n = { kind: 'number', min: 10, max: 20 } as const;
    expect([9, 10, 15, 20, 21].map((v) => matchesFilter(n, v))).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
    const d = { kind: 'date', min: '2026-06-01', max: '2026-06-30' } as const;
    expect(matchesFilter(d, '2026-06-01T09:00:00Z')).toBe(true);
    expect(matchesFilter(d, new Date('2026-06-30T23:59:00Z'))).toBe(true);
    expect(matchesFilter(d, '2026-07-01')).toBe(false);
  });

  it('a non-numeric value never satisfies a numeric range', () => {
    expect(matchesFilter({ kind: 'number', min: 1, max: null }, 'n/a')).toBe(false);
  });
});

describe('matchesFilter — text ops', () => {
  const of = (op: FilterValue extends { kind: 'text' } ? never : any, text: string): FilterValue =>
    ({ kind: 'text', op, text }) as FilterValue;

  it('not_contains / starts_with / ends_with / is / is_not', () => {
    expect(matchesFilter(of('not_contains', 'lip'), 'botox')).toBe(true);
    expect(matchesFilter(of('not_contains', 'lip'), 'lip filler')).toBe(false);
    expect(matchesFilter(of('starts_with', 'lip'), 'lip filler')).toBe(true);
    expect(matchesFilter(of('starts_with', 'lip'), 'a lip filler')).toBe(false);
    expect(matchesFilter(of('ends_with', 'ler'), 'lip filler')).toBe(true);
    expect(matchesFilter(of('is', 'lip filler'), 'Lip Filler')).toBe(true);
    expect(matchesFilter(of('is', 'lip filler'), 'lip filler xl')).toBe(false);
    expect(matchesFilter(of('is_not', 'lip filler'), 'botox')).toBe(true);
    expect(matchesFilter(of('is_not', 'lip filler'), 'lip filler')).toBe(false);
  });

  it('is_empty / is_not_empty read emptiness, not the (irrelevant) text field', () => {
    expect(matchesFilter({ kind: 'text', op: 'is_empty', text: '' }, null)).toBe(true);
    expect(matchesFilter({ kind: 'text', op: 'is_empty', text: '' }, '')).toBe(true);
    expect(matchesFilter({ kind: 'text', op: 'is_empty', text: '' }, 'x')).toBe(false);
    expect(matchesFilter({ kind: 'text', op: 'is_not_empty', text: '' }, 'x')).toBe(true);
    expect(matchesFilter({ kind: 'text', op: 'is_not_empty', text: '' }, null)).toBe(false);
  });
});

describe('matchesFilter — number ops', () => {
  it('eq / neq / gt / gte / lt / lte compare against the min-held operand', () => {
    expect(matchesFilter({ kind: 'number', op: 'eq', min: 10, max: null }, 10)).toBe(true);
    expect(matchesFilter({ kind: 'number', op: 'eq', min: 10, max: null }, 11)).toBe(false);
    expect(matchesFilter({ kind: 'number', op: 'neq', min: 10, max: null }, 11)).toBe(true);
    expect(matchesFilter({ kind: 'number', op: 'neq', min: 10, max: null }, 10)).toBe(false);
    expect(matchesFilter({ kind: 'number', op: 'gt', min: 10, max: null }, 11)).toBe(true);
    expect(matchesFilter({ kind: 'number', op: 'gt', min: 10, max: null }, 10)).toBe(false);
    expect(matchesFilter({ kind: 'number', op: 'gte', min: 10, max: null }, 10)).toBe(true);
    expect(matchesFilter({ kind: 'number', op: 'lt', min: 10, max: null }, 9)).toBe(true);
    expect(matchesFilter({ kind: 'number', op: 'lte', min: 10, max: null }, 10)).toBe(true);
  });

  it('is_empty / is_not_empty ignore min/max and read the raw value', () => {
    expect(matchesFilter({ kind: 'number', op: 'is_empty', min: null, max: null }, null)).toBe(
      true,
    );
    expect(matchesFilter({ kind: 'number', op: 'is_empty', min: null, max: null }, 0)).toBe(false);
    expect(matchesFilter({ kind: 'number', op: 'is_not_empty', min: null, max: null }, 0)).toBe(
      true,
    );
  });
});

describe('matchesFilter — date ops', () => {
  it('is / before / after / on_or_before / on_or_after compare day strings', () => {
    const on = (op: string) => ({ kind: 'date', op, min: '2026-06-15', max: null }) as FilterValue;
    expect(matchesFilter(on('is'), '2026-06-15')).toBe(true);
    expect(matchesFilter(on('is'), '2026-06-16')).toBe(false);
    expect(matchesFilter(on('before'), '2026-06-14')).toBe(true);
    expect(matchesFilter(on('before'), '2026-06-15')).toBe(false);
    expect(matchesFilter(on('after'), '2026-06-16')).toBe(true);
    expect(matchesFilter(on('on_or_before'), '2026-06-15')).toBe(true);
    expect(matchesFilter(on('on_or_after'), '2026-06-15')).toBe(true);
  });

  it('is_empty / is_not_empty read whether the value parses as a date', () => {
    expect(matchesFilter({ kind: 'date', op: 'is_empty', min: null, max: null }, null)).toBe(true);
    expect(
      matchesFilter({ kind: 'date', op: 'is_empty', min: null, max: null }, '2026-01-01'),
    ).toBe(false);
    expect(
      matchesFilter({ kind: 'date', op: 'is_not_empty', min: null, max: null }, '2026-01-01'),
    ).toBe(true);
  });

  it('relative windows are computed from the pinned `now`, inclusive both ends', () => {
    const rel = (r: string): FilterValue => ({
      kind: 'date',
      op: 'relative',
      min: null,
      max: null,
      rel: r as any,
    });
    expect(matchesFilter(rel('today'), '2026-09-30', NOW)).toBe(true);
    expect(matchesFilter(rel('today'), '2026-09-29', NOW)).toBe(false);
    expect(matchesFilter(rel('yesterday'), '2026-09-29', NOW)).toBe(true);
    expect(matchesFilter(rel('tomorrow'), '2026-10-01', NOW)).toBe(true);
    // this_week: Mon 2026-09-28 .. Sun 2026-10-04
    expect(matchesFilter(rel('this_week'), '2026-09-28', NOW)).toBe(true);
    expect(matchesFilter(rel('this_week'), '2026-10-04', NOW)).toBe(true);
    expect(matchesFilter(rel('this_week'), '2026-09-27', NOW)).toBe(false);
    expect(matchesFilter(rel('this_week'), '2026-10-05', NOW)).toBe(false);
    // past_week: the 7 days ending today (2026-09-24 .. 2026-09-30)
    expect(matchesFilter(rel('past_week'), '2026-09-24', NOW)).toBe(true);
    expect(matchesFilter(rel('past_week'), '2026-09-30', NOW)).toBe(true);
    expect(matchesFilter(rel('past_week'), '2026-09-23', NOW)).toBe(false);
    // next_week: the 7 days after today (2026-10-01 .. 2026-10-07)
    expect(matchesFilter(rel('next_week'), '2026-10-01', NOW)).toBe(true);
    expect(matchesFilter(rel('next_week'), '2026-10-07', NOW)).toBe(true);
    expect(matchesFilter(rel('next_week'), '2026-10-08', NOW)).toBe(false);
    // next_month: the 30 days after today
    expect(matchesFilter(rel('next_month'), '2026-10-30', NOW)).toBe(true);
    expect(matchesFilter(rel('next_month'), '2026-10-31', NOW)).toBe(false);
  });

  it('relativeWindow endpoints match matchesFilter’s own boundaries', () => {
    const [from, to] = relativeWindow('past_month', NOW);
    expect(
      matchesFilter(
        { kind: 'date', op: 'relative', min: null, max: null, rel: 'past_month' },
        from,
        NOW,
      ),
    ).toBe(true);
    expect(
      matchesFilter(
        { kind: 'date', op: 'relative', min: null, max: null, rel: 'past_month' },
        to,
        NOW,
      ),
    ).toBe(true);
  });
});

describe('matchesFilter — enum ops', () => {
  it('is_not / is_empty / is_not_empty', () => {
    const isNot: FilterValue = { kind: 'enum', op: 'is_not', values: ['a'] };
    expect(matchesFilter(isNot, 'b')).toBe(true);
    expect(matchesFilter(isNot, 'a')).toBe(false);
    expect(matchesFilter({ kind: 'enum', op: 'is_empty', values: [] }, [])).toBe(true);
    expect(matchesFilter({ kind: 'enum', op: 'is_empty', values: [] }, 'a')).toBe(false);
    expect(matchesFilter({ kind: 'enum', op: 'is_not_empty', values: [] }, ['a'])).toBe(true);
  });
});

describe('matchesFilter — boolean', () => {
  it('checked / unchecked treat anything but literal true as unchecked', () => {
    expect(matchesFilter({ kind: 'boolean', op: 'checked' }, true)).toBe(true);
    expect(matchesFilter({ kind: 'boolean', op: 'checked' }, false)).toBe(false);
    expect(matchesFilter({ kind: 'boolean', op: 'unchecked' }, false)).toBe(true);
    expect(matchesFilter({ kind: 'boolean', op: 'unchecked' }, null)).toBe(true);
    expect(matchesFilter({ kind: 'boolean', op: 'unchecked' }, true)).toBe(false);
  });
});

describe('matchesGroup', () => {
  type Row = { name: string; age: number; active: boolean };
  const rows: Row[] = [
    { name: 'Ana', age: 30, active: true },
    { name: 'Beto', age: 17, active: false },
    { name: 'Caro', age: 45, active: true },
  ];
  function matchOf(key: string) {
    if (key === 'name') return (r: unknown) => (r as Row).name;
    if (key === 'age') return (r: unknown) => (r as Row).age;
    if (key === 'active') return (r: unknown) => (r as Row).active;
    return null;
  }

  it('and of zero items is true; or of zero items is true', () => {
    const and: FilterGroup = emptyGroup();
    expect(matchesGroup(and, rows[0], matchOf)).toBe(true);
    expect(matchesGroup({ ...and, logic: 'or' }, rows[0], matchOf)).toBe(true);
  });

  it('and narrows to rows matching every rule', () => {
    const group: FilterGroup = {
      id: 'g1',
      logic: 'and',
      items: [
        { id: 'r1', key: 'age', value: { kind: 'number', op: 'gt', min: 20, max: null } },
        { id: 'r2', key: 'active', value: { kind: 'boolean', op: 'checked' } },
      ],
    };
    expect(rows.filter((r) => matchesGroup(group, r, matchOf))).toEqual([rows[0], rows[2]]);
  });

  it('or widens to rows matching any rule', () => {
    const group: FilterGroup = {
      id: 'g1',
      logic: 'or',
      items: [
        { id: 'r1', key: 'age', value: { kind: 'number', op: 'lt', min: 18, max: null } },
        { id: 'r2', key: 'name', value: { kind: 'text', op: 'is', text: 'Caro' } },
      ],
    };
    expect(rows.filter((r) => matchesGroup(group, r, matchOf)).map((r) => r.name)).toEqual([
      'Beto',
      'Caro',
    ]);
  });

  it('nested groups combine independently of the parent logic', () => {
    // active AND (age < 18 OR name is Caro)
    const group: FilterGroup = {
      id: 'g1',
      logic: 'and',
      items: [
        { id: 'r1', key: 'active', value: { kind: 'boolean', op: 'checked' } },
        {
          id: 'g2',
          logic: 'or',
          items: [
            { id: 'r2', key: 'age', value: { kind: 'number', op: 'lt', min: 18, max: null } },
            { id: 'r3', key: 'name', value: { kind: 'text', op: 'is', text: 'Caro' } },
          ],
        },
      ],
    };
    expect(rows.filter((r) => matchesGroup(group, r, matchOf)).map((r) => r.name)).toEqual([
      'Caro',
    ]);
  });

  it('an unknown key is inert and never hides a row', () => {
    const group: FilterGroup = {
      id: 'g1',
      logic: 'and',
      items: [
        { id: 'r1', key: 'ghost_column', value: { kind: 'text', op: 'is', text: 'anything' } },
      ],
    };
    expect(rows.every((r) => matchesGroup(group, r, matchOf))).toBe(true);
  });
});

describe('emptyRule / emptyGroup', () => {
  it('emptyRule carries the default op and an inert value', () => {
    const rule = emptyRule('age', 'number');
    expect(rule.key).toBe('age');
    expect(rule.value).toMatchObject({ kind: 'number', op: 'between' });
    expect(isFilterActive(rule.value)).toBe(false);
  });

  it('emptyGroup starts as an empty and-group', () => {
    const g = emptyGroup();
    expect(g.logic).toBe('and');
    expect(g.items).toEqual([]);
  });

  it('ids are unique', () => {
    expect(emptyRule('a', 'text').id).not.toBe(emptyRule('a', 'text').id);
  });
});

describe('filterToParam', () => {
  it('keeps the historical comma-joined enum form and encodes a range as min~max for default ops', () => {
    expect(filterToParam({ kind: 'enum', values: ['a', 'b'] })).toBe('a,b');
    expect(filterToParam({ kind: 'text', text: ' hi ' })).toBe('hi');
    expect(filterToParam({ kind: 'number', min: 1, max: null })).toBe('1~');
    expect(filterToParam({ kind: 'date', min: null, max: '2026-01-31' })).toBe('~2026-01-31');
  });

  it('an explicit default op serializes identically to an absent op', () => {
    expect(filterToParam({ kind: 'text', op: 'contains', text: 'hi' })).toBe('hi');
  });

  it('a non-default op is prefixed `op:<payload>`', () => {
    expect(filterToParam({ kind: 'text', op: 'starts_with', text: 'hi' })).toBe('starts_with:hi');
    expect(filterToParam({ kind: 'enum', op: 'is_not', values: ['a'] })).toBe('is_not:a');
    expect(filterToParam({ kind: 'number', op: 'gt', min: 5, max: null })).toBe('gt:5~');
    expect(filterToParam({ kind: 'boolean', op: 'unchecked' })).toBe('unchecked:unchecked');
  });
});
