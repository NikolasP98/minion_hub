// @vitest-environment happy-dom
/**
 * HC-015 — board reclassification has a keyboard/tap baseline. Every card
 * carries a "Move to…" menu (the shared Zag menu under `Dropdown`); choosing a
 * column performs the ONE write a drop would (`BookingBoard.move`), the card
 * keeps focus in its new column and a polite live region announces the result
 * — "moved" or, when the write was refused (HC-015B), "could not move".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick, type ComponentProps } from 'svelte';
import BookingBoard from './BookingBoard.svelte';
import type { BookingCustomValues } from './kit/booking-custom-values.svelte';
import {
  EVENTS,
  EVENT_TYPES,
  FIXTURE_TIME_ZONE,
  RESOURCES,
} from '../../../../tests/fixtures/mobile-composition/seed';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Zag schedules focus/highlight through rAF + microtasks; let them land. */
async function settle() {
  await tick();
  await new Promise((r) => setTimeout(r, 40));
  await tick();
}

const SUBJECT = EVENTS[0]; // Paciente 1A, status accepted (labelled "Confirmed")
const PROP = {
  id: 'p1',
  tableId: 'scheduling.bookings',
  label: 'Room',
  type: 'select',
  rules: {
    type: 'select',
    options: [
      { id: 'a', label: 'Room A', color: null, archivedAt: null },
      { id: 'b', label: 'Room B', color: null, archivedAt: null },
    ],
  },
  hasDefault: false,
  defaultValue: null,
  archivedAt: null,
  version: 1,
};

function fakeValues(apply: BookingCustomValues['apply']): BookingCustomValues {
  return {
    selectDefs: [PROP],
    editable: {},
    ensure: () => {},
    valueOf: () => 'a',
    apply,
  } as unknown as BookingCustomValues;
}

function mount(props: Partial<ComponentProps<typeof BookingBoard>> = {}) {
  const onstatus = vi.fn(async (_id: string, _status: string) => {});
  const view = render(BookingBoard, {
    props: {
      bookings: EVENTS.slice(0, 2),
      resources: RESOURCES,
      eventTypes: EVENT_TYPES,
      timeZone: FIXTURE_TIME_ZONE,
      customValues: fakeValues(async () => ({ ok: [], failed: [] })),
      axis: 'status',
      onaxis: () => {},
      onopen: () => {},
      onstatus,
      ...props,
    },
  });
  return { view, onstatus };
}

const menuEl = () => document.querySelector<HTMLElement>('[role="menu"]:not([hidden])');
const highlighted = () => {
  const id = menuEl()?.getAttribute('aria-activedescendant');
  return id ? document.getElementById(id) : null;
};
type Mounted = { container: HTMLElement };
const live = (view: Mounted) => view.container.querySelector<HTMLElement>('[aria-live="polite"]')!;
const subjectWrap = (view: Mounted) =>
  view.container.querySelector<HTMLElement>(`[data-row-key="${SUBJECT.id}"]`)!;
const columnOf = (el: HTMLElement) => el.closest('section')!.getAttribute('aria-label');

/** Enter on the trigger opens the menu; arrows walk to the wanted label. */
async function openAndWalkTo(trigger: HTMLElement, label: string) {
  await fireEvent.keyDown(trigger, { key: 'Enter' });
  await settle();
  expect(menuEl()).not.toBeNull();
  for (let i = 0; i < 12 && highlighted()?.textContent?.trim() !== label; i++) {
    await fireEvent.keyDown(menuEl()!, { key: 'ArrowDown' });
    await settle();
  }
  expect(highlighted()?.textContent?.trim()).toBe(label);
}

describe('BookingBoard "Move to…" keyboard path (HC-015)', () => {
  it('Enter opens, arrows pick a column, Enter writes ONCE, the card keeps focus in its new column, the live region says so', async () => {
    const { view, onstatus } = mount();
    const wrap = subjectWrap(view);
    expect(columnOf(wrap)).toBe('Confirmed');
    const trigger = wrap.querySelector<HTMLElement>('[data-scope="menu"][data-part="trigger"]')!;
    expect(trigger.textContent).toContain('Move to…');
    // The current column is listed but disabled.
    trigger.focus();
    await openAndWalkTo(trigger, 'Completed');
    const current = [...document.querySelectorAll('[role="menuitem"]')].find((el) =>
      el.textContent?.includes('Confirmed'),
    );
    expect(current?.getAttribute('aria-disabled')).toBe('true');

    // The write resolves after the parent re-rendered (as the mover does).
    onstatus.mockImplementationOnce(async (id: string, status: string) => {
      await view.rerender({
        bookings: EVENTS.slice(0, 2).map((b) => (b.id === id ? { ...b, status } : b)),
      });
    });
    await fireEvent.keyDown(menuEl()!, { key: 'Enter' });
    await settle();
    await settle();

    expect(onstatus).toHaveBeenCalledTimes(1);
    expect(onstatus).toHaveBeenCalledWith(SUBJECT.id, 'completed');
    const moved = subjectWrap(view);
    expect(columnOf(moved)).toBe('Completed');
    expect(document.activeElement).toBe(moved.querySelector('.bcard'));
    expect(live(view).textContent).toBe(`${SUBJECT.attendeeName} moved to Completed`);
  });

  it('Escape closes without a write and returns focus to the trigger', async () => {
    const { view, onstatus } = mount();
    const trigger = subjectWrap(view).querySelector<HTMLElement>(
      '[data-scope="menu"][data-part="trigger"]',
    )!;
    trigger.focus();
    await openAndWalkTo(trigger, 'Completed');
    await fireEvent.keyDown(menuEl()!, { key: 'Escape' });
    await settle();
    expect(menuEl()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onstatus).not.toHaveBeenCalled();
    expect(live(view).textContent).toBe('');
  });

  it('HC-015B: a refused custom-column write announces the failure (one apply, no second write)', async () => {
    const apply = vi.fn(async () => ({
      ok: [],
      failed: [{ id: SUBJECT.id, reason: 'version_conflict' }],
    }));
    const { view } = mount({ axis: 'prop:p1', customValues: fakeValues(apply) });
    const trigger = subjectWrap(view).querySelector<HTMLElement>(
      '[data-scope="menu"][data-part="trigger"]',
    )!;
    trigger.focus();
    await openAndWalkTo(trigger, 'Room B');
    await fireEvent.keyDown(menuEl()!, { key: 'Enter' });
    await settle();
    await settle();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(PROP, [SUBJECT.id], 'b');
    expect(live(view).textContent).toBe(`Could not move ${SUBJECT.attendeeName}`);
    expect(columnOf(subjectWrap(view))).toBe('Room A');
  });
});
