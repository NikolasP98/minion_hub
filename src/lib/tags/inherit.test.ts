import { describe, it, expect } from 'vitest';
import { descendantIds, inheritedFromDescendants, mergeTags } from './inherit';

const t = (id: string) => ({ id, name: id.toUpperCase(), color: null });

describe('descendantIds', () => {
  it('walks children and grandchildren, never the root itself', () => {
    const edges = [
      { parentItemId: 'recipe', childItemId: 'sauce' },
      { parentItemId: 'sauce', childItemId: 'tomato' },
      { parentItemId: 'recipe', childItemId: 'bun' },
    ];
    expect([...descendantIds(edges, ['recipe']).get('recipe')!].sort()).toEqual([
      'bun',
      'sauce',
      'tomato',
    ]);
    expect(descendantIds(edges, ['tomato']).get('tomato')!.size).toBe(0);
  });

  it('terminates on a cycle', () => {
    const edges = [
      { parentItemId: 'a', childItemId: 'b' },
      { parentItemId: 'b', childItemId: 'a' },
    ];
    expect([...descendantIds(edges, ['a']).get('a')!]).toEqual(['b']);
  });
});

describe('mergeTags', () => {
  it('dedupes by id keeping the first occurrence', () => {
    expect(mergeTags([t('x'), t('y')], [t('y'), t('z')]).map((x) => x.id)).toEqual(['x', 'y', 'z']);
  });
});

describe('inheritedFromDescendants', () => {
  it('merges descendant tags per root and includes extra direct ingredients', () => {
    const edges = [
      { parentItemId: 'recipe', childItemId: 'sauce' },
      { parentItemId: 'sauce', childItemId: 'tomato' },
    ];
    const own = new Map([
      ['sauce', [t('spicy')]],
      ['tomato', [t('vegan'), t('spicy')]],
      ['salt', [t('mineral')]],
      ['recipe', [t('own-only')]], // a root's own tags are not "inherited"
    ]);
    const extra = new Map([['recipe', ['salt']]]);
    const out = inheritedFromDescendants(edges, ['recipe', 'tomato'], own, extra);
    expect(out.get('recipe')!.map((x) => x.id)).toEqual(['spicy', 'vegan', 'mineral']);
    expect(out.get('tomato')).toEqual([]);
  });
});
