// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import MemberCalendarStrip from './MemberCalendarStrip.svelte';

afterEach(cleanup);

const bookings = [
  {
    id: 'boundary',
    start: '2026-10-02T11:30:00.000Z',
    end: '2026-10-02T12:00:00.000Z',
    status: 'accepted',
    attendeeName: 'Synthetic',
    title: 'Consultation',
  },
];

describe('MemberCalendarStrip timezone projection', () => {
  it('moves a boundary booking to the organization day and formats its organization time', async () => {
    const view = render(MemberCalendarStrip, {
      props: {
        weekStart: '2026-10-01',
        bookings,
        timeZone: 'Pacific/Kiritimati',
      },
    });
    const day = (number: string) =>
      [...view.container.querySelectorAll('.day')].find(
        (node) => node.querySelector('.dn')?.textContent === number,
      );

    expect(day('3')?.textContent).toContain('01:30');
    expect(day('2')?.textContent).not.toContain('Synthetic');

    await view.rerender({
      weekStart: '2026-10-01',
      bookings,
      timeZone: 'America/Lima',
    });
    expect(day('2')?.textContent).toContain('06:30');
    expect(day('3')?.textContent).not.toContain('Synthetic');
  });
});
