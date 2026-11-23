// @vitest-environment happy-dom
/**
 * HC-023A — board column titles: the full label is the accessible text of a
 * focusable element with no native `title`, so a truncated name is reachable
 * by keyboard and touch through the shared Tooltip (the open itself needs
 * layout — Playwright `calendar-cluster-s4.spec.ts`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import BoardView from './BoardView.svelte';

afterEach(cleanup);

const COLUMNS = [
  { id: 'a', label: 'Nikolas Sebastian Pinon Sarria' },
  { id: 'b', label: 'Leiva' },
];
const ROWS = [
  { id: 'x', col: 'a' },
  { id: 'y', col: null },
];

describe('BoardView column heads', () => {
  it('carry the full label, are focusable and have no native title', () => {
    const view = render(BoardView<{ id: string; col: string | null }>, {
      columns: COLUMNS,
      rows: ROWS,
      columnOf: (r) => r.col,
      rowKey: (r) => r.id,
      card: createRawSnippet((row: () => { id: string }) => ({
        render: () => `<span>${row().id}</span>`,
      })),
    });
    const titles = [...view.container.querySelectorAll<HTMLElement>('.btitle')];
    // Two declared columns plus the trailing "unclassified" one for row `y`.
    expect(titles.map((t) => t.textContent?.trim())).toEqual([
      'Nikolas Sebastian Pinon Sarria',
      'Leiva',
      expect.any(String),
    ]);
    for (const t of titles) {
      expect(t.tabIndex).toBe(0);
      expect(t.getAttribute('title')).toBeNull();
    }
    expect(view.container.querySelector('[title]')).toBeNull();
  });
});

/**
 * Spec 146 — the three opt-in abilities an embedded board needs. With the defaults
 * (first test) the existing boards keep their button cards, their "unset" target
 * and their fixed-width scrolling columns.
 */
describe('BoardView opt-in props (spec 146)', () => {
  const card = createRawSnippet((row: () => { id: string }) => ({
    render: () => `<span>${row().id}</span>`,
  }));
  const base = {
    columns: COLUMNS,
    rows: [{ id: 'x', col: 'a' as string | null }],
    columnOf: (r: { col: string | null }) => r.col,
    rowKey: (r: { id: string }) => r.id,
    card,
  };

  it('defaults: a button card, no fit class, the trailing unset column when a row needs it', () => {
    const view = render(BoardView<{ id: string; col: string | null }>, {
      ...base,
      rows: ROWS,
      onopen: () => {},
      onmove: () => {},
    });
    expect(view.container.querySelector('.board')?.classList.contains('is-fit')).toBe(false);
    expect(view.container.querySelectorAll('button.bcard')).toHaveLength(2);
    expect(view.container.querySelectorAll('section.bcol')).toHaveLength(3);
  });

  it('fit + unclassified=false + no onopen: shared width, no unset column, plain cards', () => {
    const view = render(BoardView<{ id: string; col: string | null }>, {
      ...base,
      rows: ROWS,
      onmove: () => {},
      fit: true,
      unclassified: false,
    });
    expect(view.container.querySelector('.board')?.classList.contains('is-fit')).toBe(true);
    expect(view.container.querySelectorAll('section.bcol')).toHaveLength(2);
    expect(view.container.querySelector('button.bcard')).toBeNull();
    expect(view.container.querySelector('div.bcard')?.textContent).toBe('x');
  });
});
