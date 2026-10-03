// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'svelte';
import { tick } from 'svelte';

vi.mock('$app/environment', async (original) => ({
  ...(await original<typeof import('$app/environment')>()),
  browser: true,
}));
vi.mock('$lib/state/ui/preference-sync.svelte', () => ({ syncPreferenceToServer: vi.fn() }));
const { default: TimeOffView } = await import('./TimeOffView.svelte');

const props: ComponentProps<typeof TimeOffView> = {
  employees: [
    {
      id: 'employee-a',
      profileId: null,
      resourceId: null,
      name: 'Synthetic employee',
      email: null,
      designation: null,
      department: null,
      employmentType: null,
      status: 'active',
      joinedOn: null,
      leftOn: null,
      color: null,
    },
  ],
  leaveTypes: [{ id: 'leave-a', code: 'vacation', name: 'Synthetic vacation', paid: true }],
  allocations: [],
  requests: [],
  holidays: [],
  members: [],
  hrSettings: { weeklyOff: [0, 6], country: null },
  canEdit: true,
  canDecide: false,
  myEmployeeId: 'employee-a',
  requestFor: 'employee-a',
  scopeKey: 'org-a',
  timeZone: 'America/Lima',
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('shows a real balance read failure in the request dialog and retries without closing the draft', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ message: 'Balance unavailable' }, { status: 403 }))
    .mockResolvedValueOnce(
      Response.json({ balance: { allocated: 12, available: 7, approved: 4, pending: 1 } }),
    );
  vi.stubGlobal('fetch', fetch);
  const view = render(TimeOffView, { props });
  const dialog = await view.findByRole('dialog');
  await waitFor(() =>
    expect(within(dialog).getByRole('alert').textContent).toContain('Balance unavailable'),
  );
  await fireEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(dialog.textContent).toContain('7'));
  await waitFor(() => expect(within(dialog).queryByRole('alert')).toBeNull());
  expect(view.getByRole('dialog')).toBe(dialog);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(dialog.textContent).toContain('7');
});

it('closes the old request on an organization change and ignores a late balance response', async () => {
  let finish!: (value: Response) => void;
  const fetch = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal('fetch', fetch);
  const view = render(TimeOffView, { props });
  await view.findByRole('dialog');
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  await view.rerender({ ...props, scopeKey: 'org-b', employees: [], leaveTypes: [] });
  const closing = view.getByRole('dialog');
  await waitFor(() => expect(closing.hasAttribute('data-closing')).toBe(true));
  // happy-dom does not run CSS; the native-browser lane covers animation and focus.
  await fireEvent.animationEnd(closing.querySelector('[data-part="content"]')!);
  await waitFor(() => expect(view.container.querySelector('dialog[open]')).toBeNull());
  expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].signal?.aborted).toBe(true);
  finish(Response.json({ balance: { allocated: 999, available: 999, approved: 0, pending: 0 } }));
  await tick();
  expect(view.container.querySelector('dialog[open]')).toBeNull();
  expect(fetch).toHaveBeenCalledOnce();
  expect(view.queryByText(/999/)).toBeNull();
});
