// @vitest-environment happy-dom
/**
 * HC-023A — board column titles: the full label is the accessible text of a
 * focusable element with no native `title`, so a truncated name is reachable
 * by keyboard and touch through the shared Tooltip (the open itself needs
 * layout — Playwright `calendar-cluster-s4.spec.ts`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
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

/**
 * Spec 152 PR C — keyboard drag: Space picks a card up, Left / Right choose the column,
 * Space or Enter drops, Escape cancels; every step goes through the shared announcer.
 */
describe('BoardView keyboard drag (spec 152)', () => {
  const COLS = [
    { id: 'todo', label: 'Todo' },
    { id: 'doing', label: 'Doing' },
    { id: 'done', label: 'Done' },
  ];
  const card = createRawSnippet((row: () => { id: string }) => ({
    render: () => `<span>${row().id}</span>`,
  }));
  const said = () =>
    new Promise<string>((resolve) =>
      requestAnimationFrame(() =>
        resolve(document.querySelector('[data-announcer="assertive"]')?.textContent ?? ''),
      ),
    );
  const key = (el: Element, k: string) => fireEvent.keyDown(el, { key: k });

  function mount(extra: { onopen?: (row: { id: string }) => void } = {}) {
    const moves: [string, string | null][] = [];
    const view = render(BoardView<{ id: string; col: string }>, {
      columns: COLS,
      rows: [{ id: 'Task one', col: 'todo' }],
      columnOf: (r) => r.col,
      rowKey: (r) => r.id,
      card,
      unclassified: false,
      onmove: (row, id) => void moves.push([row.id, id]),
      ...extra,
    });
    const el = view.container.querySelector<HTMLElement>('.bcard')!;
    el.focus();
    const over = () => view.container.querySelector('.bcol.is-over')?.getAttribute('aria-label');
    return { view, el, moves, over };
  }

  it('picks up, moves across columns and drops with one write', async () => {
    const { el, moves, over } = mount();
    expect(el.getAttribute('role')).toBe('button');
    expect(document.getElementById(el.getAttribute('aria-describedby')!)?.textContent).toMatch(
      /Space/,
    );

    await key(el, ' ');
    expect(el.getAttribute('aria-pressed')).toBe('true');
    expect(await said()).toMatch(/^Task one picked up in Todo\./);

    await key(el, 'ArrowRight');
    await key(el, 'ArrowRight');
    await key(el, 'ArrowRight'); // stops at the last column
    expect(over()).toBe('Done');
    expect(await said()).toBe('Task one over Done');
    await key(el, 'ArrowLeft');
    expect(over()).toBe('Doing');

    await key(el, 'Enter');
    expect(moves).toEqual([['Task one', 'doing']]);
    expect(over()).toBeUndefined();
  });

  it('Escape and dropping where it started cancel without a write', async () => {
    const { el, moves, over } = mount();
    await key(el, ' ');
    await key(el, 'ArrowRight');
    await key(el, 'Escape');
    expect(over()).toBeUndefined();
    expect(await said()).toBe('Task one was not moved');

    await key(el, 'Enter'); // a card with nothing to open: Enter picks up too
    expect(el.getAttribute('aria-pressed')).toBe('true');
    await key(el, ' ');
    expect(moves).toEqual([]);
  });

  it('leaving the card cancels the move', async () => {
    const { el, moves, over } = mount();
    await key(el, ' ');
    await key(el, 'ArrowRight');
    await fireEvent.focusOut(el, { relatedTarget: document.body });
    expect(over()).toBeUndefined();
    expect(moves).toEqual([]);
  });

  it('a card that opens a record keeps Enter for opening; Space picks it up', async () => {
    const opened: string[] = [];
    const { el } = mount({ onopen: (row) => opened.push(row.id) });
    expect(el.tagName).toBe('BUTTON');
    await key(el, 'Enter');
    expect(document.querySelector('.bcard-wrap.is-dragging')).toBeNull();
    await fireEvent.click(el);
    expect(opened).toEqual(['Task one']);

    await key(el, ' ');
    expect(document.querySelector('.bcard-wrap.is-dragging')).not.toBeNull();
    await fireEvent.click(el, { detail: 0 }); // the click Space synthesises on a button
    expect(opened).toEqual(['Task one']);

    // Chrome fires no click for a prevented Space. Once the key is released, the next
    // Enter (a keyboard click, detail 0) must open the record again.
    await key(el, 'Escape');
    await key(el, ' ');
    await fireEvent.keyUp(el, { key: ' ' });
    await key(el, 'Escape');
    await new Promise((r) => setTimeout(r, 5));
    await fireEvent.click(el, { detail: 0 });
    expect(opened).toEqual(['Task one', 'Task one']);
  });
});
