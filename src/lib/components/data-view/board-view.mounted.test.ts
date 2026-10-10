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
