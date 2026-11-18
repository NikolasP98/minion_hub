import { describe, expect, it } from 'vitest';
import {
  addAlternative,
  choicePathError,
  defaultBranch,
  makeDefault,
  recipeTree,
  selectedRows,
  type ChoiceRow,
} from './recipe-choice';

const row = (itemId: string, choicePath: string | null = null): ChoiceRow => ({
  itemId,
  choicePath,
});
const ids = (rows: ChoiceRow[]) => rows.map((r) => r.itemId);

describe('recipe choices (meta spec 131)', () => {
  // A + (B | C)
  const aBc = [row('A'), row('B', '1.0'), row('C', '1.1')];
  // X + (Y | (W + (Z | Q)))
  const deep = [
    row('X'),
    row('Y', '1.0'),
    row('W', '1.1'),
    row('Z', '1.1/2.0'),
    row('Q', '1.1/2.1'),
  ];

  it('takes every default when nobody picks', () => {
    expect(ids(defaultBranch(aBc))).toEqual(['A', 'B']);
    expect(ids(defaultBranch(deep))).toEqual(['X', 'Y']);
    // A | (B + C): the default option is A alone.
    expect(ids(defaultBranch([row('A', '1.0'), row('B', '1.1'), row('C', '1.1')]))).toEqual(['A']);
  });

  it('follows picks into nested choices', () => {
    expect(ids(selectedRows(aBc, new Map([[1, 1]])))).toEqual(['A', 'C']);
    expect(ids(selectedRows(deep, new Map([[1, 1]])))).toEqual(['X', 'W', 'Z']);
    expect(
      ids(
        selectedRows(
          deep,
          new Map([
            [1, 1],
            [2, 1],
          ]),
        ),
      ),
    ).toEqual(['X', 'W', 'Q']);
  });

  it('scopes choice groups per recipe when rows of several products mix', () => {
    const mixed = [
      { ...row('B', '1.0'), finProductId: 'p1' },
      { ...row('C', '1.1'), finProductId: 'p1' },
      { ...row('D', '1.3'), finProductId: 'p2' },
      { ...row('E', '1.4'), finProductId: 'p2' },
    ];
    expect(ids(defaultBranch(mixed))).toEqual(['B', 'D']);
  });

  it('a choice whose other options were deleted is plain rows, default = what is left', () => {
    const rows = [row('A'), row('C', '1.1')];
    expect(ids(defaultBranch(rows))).toEqual(['A', 'C']);
    expect(recipeTree(rows).map((n) => n.kind)).toEqual(['item', 'item']);
  });

  it('builds the tree default-first', () => {
    const tree = recipeTree(deep);
    expect(tree[0]).toMatchObject({ kind: 'item', row: { itemId: 'X' } });
    const choice = tree[1];
    if (choice.kind !== 'choice') throw new Error('expected a choice');
    expect(choice.options.map((o) => o.path)).toEqual(['1.0', '1.1']);
    const inner = choice.options[1].nodes;
    expect(inner[0]).toMatchObject({ kind: 'item', row: { itemId: 'W' } });
    expect(inner[1]).toMatchObject({ kind: 'choice', group: 2 });
  });

  it('rejects incoherent paths', () => {
    expect(choicePathError(deep)).toBeNull();
    expect(choicePathError([row('A', '1')])).toMatch(/invalid/);
    expect(choicePathError([row('A', '1.0/1.1')])).toMatch(/repeats/);
    expect(choicePathError([row('A', '2.0'), row('B', '1.0/2.1')])).toMatch(/two places/);
  });

  it('"or…" on a lone row adds an option; on a shared row it nests a new choice', () => {
    const add = row('C');
    // A alone at the top → A | C
    expect(addAlternative([row('A'), row('B')], 'A', add)).toEqual([
      row('A', '1.0'),
      row('B'),
      row('C', '1.1'),
    ]);
    // B alone in option 1.0 → a third option of choice 1
    expect(addAlternative(aBc, 'B', row('D')).at(-1)).toEqual(row('D', '1.2'));
    // W shares option 1.1 with the Z|Q choice → W gets its own choice inside 1.1
    const next = addAlternative(deep, 'W', row('V'));
    expect(next.find((r) => r.itemId === 'W')?.choicePath).toBe('1.1/3.0');
    expect(next.at(-1)).toEqual(row('V', '1.1/3.1'));
    expect(choicePathError(next)).toBeNull();
  });

  it('make default swaps the option numbers, nested rows included', () => {
    const next = makeDefault(deep, 1, 1);
    expect(ids(defaultBranch(next))).toEqual(['X', 'W', 'Z']);
    expect(next.find((r) => r.itemId === 'Q')?.choicePath).toBe('1.0/2.1');
    expect(next.find((r) => r.itemId === 'Y')?.choicePath).toBe('1.1');
  });
});
