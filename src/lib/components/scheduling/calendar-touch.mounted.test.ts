// @vitest-environment happy-dom
/**
 * Spec 145 S2 — touch on `BookingCalendar`: the tap summary sheet, the touch
 * card, and the grid's `data-dense`. happy-dom lays nothing out and has no
 * touch gestures: scrolling, hold-and-drag and block heights are verified in
 * Chromium (`tests/e2e/ui-audit/calendar-mobile.spec.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import BookingCalendar from './BookingCalendar.svelte';
import {
  EVENTS,
  EVENT_TYPES,
  FIXTURE_DAY,
  FIXTURE_TIME_ZONE,
  RESOURCES,
} from '../../../../tests/fixtures/mobile-composition/seed';

const TZ = FIXTURE_TIME_ZONE;
const SUBJECT = EVENTS[0];

function mount(props: Record<string, unknown> = {}) {
  const onopen = vi.fn();
  const actionArgs: Array<{ touch?: boolean } | undefined> = [];
  const actions = createRawSnippet(
    (_b: () => unknown, o: () => { touch: boolean } | undefined) => ({
      render: () => {
        actionArgs.push(o());
        return `<span data-act="${o()?.touch ? 'touch' : 'hover'}">act</span>`;
      },
    }),
  );
  const view = render(BookingCalendar, {
    view: 'day',
    date: FIXTURE_DAY,
    timeZone: TZ,
    mutationScope: 'org-a',
    bookings: [SUBJECT],
    resources: RESOURCES.slice(0, 1),
    eventTypes: EVENT_TYPES,
    kinds: [],
    onview: vi.fn(),
    ondate: vi.fn(),
    onopen,
    onmove: vi.fn(),
    features: { tapSummary: true },
    actions,
    ...props,
  } as never);
  return { ...view, onopen, actionArgs };
}

const block = (c: HTMLElement) =>
  c.querySelector<HTMLElement>(`.evt[data-booking-id="${SUBJECT.id}"]`)!;
function pointerUp(el: Element, pointerType: string) {
  el.dispatchEvent(new PointerEvent('pointerup', { pointerType, bubbles: true, isPrimary: true }));
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 404 })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('touch', () => {
  it('opts the grid out of the 44px button floor', () => {
    const { container } = mount();
    expect(container.querySelector('.cal-scroll')!.hasAttribute('data-dense')).toBe(true);
  });

  it('a mouse click opens the booking directly', async () => {
    const { container, onopen } = mount();
    const el = block(container);
    pointerUp(el, 'mouse');
    await fireEvent.click(el);
    expect(onopen).toHaveBeenCalledWith(SUBJECT.id);
    expect(document.querySelector('.summary-go')).toBeNull();
  });

  it('a touch tap opens the summary sheet instead of onopen', async () => {
    const { container, onopen } = mount();
    const el = block(container);
    pointerUp(el, 'touch');
    await fireEvent.click(el);
    expect(onopen).not.toHaveBeenCalled();
    await waitFor(() => expect(document.querySelector('.summary-go')).not.toBeNull());
  });

  it('without the flag a touch tap still opens the booking', async () => {
    const { container, onopen } = mount({ features: {} });
    const el = block(container);
    pointerUp(el, 'touch');
    await fireEvent.click(el);
    expect(onopen).toHaveBeenCalledWith(SUBJECT.id);
  });

  it('the touch card shows the status, has no title opener, and gives actions { touch: true }', async () => {
    const { container, actionArgs } = mount();
    const el = block(container);
    pointerUp(el, 'touch');
    await fireEvent.click(el);
    await waitFor(() => expect(document.querySelector('.summary-go')).not.toBeNull());
    const card = document.querySelector('.hover-card')!;
    expect(card.querySelector('.hc-head-end')!.textContent!.trim()).not.toBe('');
    expect(card.querySelector('.hc-title-btn')).toBeNull();
    expect(card.querySelector('.hc-title')).not.toBeNull();
    expect(card.querySelector('[data-act="touch"]')).not.toBeNull();
    expect(actionArgs.some((a) => a?.touch === true)).toBe(true);
  });

  it('"Move to…" and "Open appointment" close the sheet and call onopen', async () => {
    const { container, onopen } = mount();
    const el = block(container);
    pointerUp(el, 'touch');
    await fireEvent.click(el);
    await waitFor(() => expect(document.querySelector('.summary-go')).not.toBeNull());
    const [move, open] = [...document.querySelectorAll<HTMLElement>('.summary-go button')];
    expect(move.textContent!.trim()).toBe('Move to…');
    await fireEvent.click(move);
    expect(onopen).toHaveBeenLastCalledWith(SUBJECT.id, { reschedule: true });

    pointerUp(el, 'touch');
    await fireEvent.click(el);
    await waitFor(() => expect(document.querySelector('.summary-go')).not.toBeNull());
    const open2 = [...document.querySelectorAll<HTMLElement>('.summary-go button')].at(-1)!;
    expect(open2.textContent!.trim()).toBe('Open appointment');
    await fireEvent.click(open2);
    expect(onopen).toHaveBeenLastCalledWith(SUBJECT.id);
  });

  it('offers no "Move to…" when the host cannot move', async () => {
    const { container } = mount({ onmove: undefined });
    const el = block(container);
    pointerUp(el, 'touch');
    await fireEvent.click(el);
    await waitFor(() => expect(document.querySelector('.summary-go')).not.toBeNull());
    expect(document.querySelectorAll('.summary-go button')).toHaveLength(1);
  });
});
