// @vitest-environment happy-dom
// HC-040: export toggles are owned by the (flow, variable) they were dispatched for.
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import FlowExports from './FlowExports.svelte';
import { toastError } from '$lib/state/ui/toast.svelte';

vi.mock('$lib/state/ui/toast.svelte', () => ({ toastError: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(toastError).mockReset();
});

const specs = [
  { key: 'report', label: 'Report', type: 'string' as const },
  { key: 'summary', label: 'Summary', type: 'string' as const },
];

type Reply = { resolve: (res: Response) => void; reject: (reason: Error) => void };

/** fetch stub that parks every PATCH until the test settles it, in any order. */
function parkedFetch() {
  const replies: Reply[] = [];
  const fetcher = vi.fn(
    (_input: string, _init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => replies.push({ resolve, reject })),
  );
  vi.stubGlobal('fetch', fetcher);
  return { fetcher, replies };
}

const checked = (name: string) => screen.getByRole('switch', { name }).getAttribute('aria-checked');

it("(a) replacing flow A with flow B shows B's committed state immediately", async () => {
  parkedFetch();
  const view = render(FlowExports, {
    flowId: 'A',
    specs,
    toggles: { report: true },
    canEdit: true,
  });
  expect(checked('Report')).toBe('true');
  await view.rerender({ flowId: 'B', toggles: { report: false } });
  expect(checked('Report')).toBe('false');
});

it("(b) a late failure of flow A's write never rolls back flow B", async () => {
  const { fetcher, replies } = parkedFetch();
  // A starts false; the optimistic write flips it to true and is left in flight.
  const view = render(FlowExports, {
    flowId: 'A',
    specs,
    toggles: { report: false },
    canEdit: true,
  });
  await fireEvent.click(view.getByRole('switch', { name: 'Report' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(String(fetcher.mock.calls[0][0])).toBe('/api/flows/A/exports');
  expect(checked('Report')).toBe('true');
  // B's committed value happens to equal A's optimistic one, so only a
  // misdirected rollback can change what B shows.
  await view.rerender({ flowId: 'B', toggles: { report: true } });
  expect(checked('Report')).toBe('true');
  replies[0].reject(new Error('synthetic late transport failure'));
  await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
  expect(checked('Report')).toBe('true');
  // Back on A, the rejected write is gone: A shows its committed value again.
  await view.rerender({ flowId: 'A', toggles: { report: false } });
  expect(checked('Report')).toBe('false');
});

it('(c) one write per variable is in flight; the next activation waits for the reply', async () => {
  const { fetcher, replies } = parkedFetch();
  const view = render(FlowExports, {
    flowId: 'A',
    specs,
    toggles: { report: true },
    canEdit: true,
  });
  const control = view.getByRole('switch', { name: 'Report' });
  await fireEvent.click(control);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(control.getAttribute('aria-busy')).toBe('true');
  // A second activation while pending must not race a second write.
  await fireEvent.click(control);
  await tick();
  expect(fetcher).toHaveBeenCalledTimes(1);
  // A different variable on the same flow is independent and may write concurrently.
  // Summary has no stored value, so it shows its default (enabled) and this writes false.
  expect(checked('Summary')).toBe('true');
  await fireEvent.click(view.getByRole('switch', { name: 'Summary' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  // The newer (summary) reply lands first and succeeds; the older (report) fails last.
  replies[1].resolve(Response.json({ ok: true }));
  await tick();
  replies[0].reject(new Error('synthetic late transport failure'));
  await waitFor(() => expect(control.getAttribute('aria-busy')).toBeNull());
  expect(checked('Report')).toBe('true'); // reverted to committed
  expect(checked('Summary')).toBe('false'); // newer success kept, no reload needed
  expect(toastError).toHaveBeenCalledTimes(1);
  // Recovery: the control is enabled again and the next activation writes anew.
  expect(control.hasAttribute('disabled')).toBe(false);
  await fireEvent.click(control);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  expect(JSON.parse(String(fetcher.mock.calls[2][1]?.body))).toEqual({
    varKey: 'report',
    enabled: false,
  });
  replies[2].resolve(Response.json({ ok: true }));
  await waitFor(() => expect(control.getAttribute('aria-busy')).toBeNull());
  expect(checked('Report')).toBe('false'); // confirmed without a page reload
});

it('(d) fresh selected-flow data replaces a confirmed write; canEdit=false stays inert', async () => {
  const { fetcher, replies } = parkedFetch();
  // Nothing stored yet: Report shows its default (enabled); the write stores false.
  const view = render(FlowExports, { flowId: 'A', specs, toggles: {}, canEdit: true });
  const control = view.getByRole('switch', { name: 'Report' });
  expect(checked('Report')).toBe('true');
  await fireEvent.click(control);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  replies[0].resolve(Response.json({ ok: true }));
  await waitFor(() => expect(control.getAttribute('aria-busy')).toBeNull());
  expect(checked('Report')).toBe('false'); // accepted, no reload needed
  // Reloaded page data (another writer set it) differs from the dispatch base and wins.
  await view.rerender({ toggles: { report: true } });
  expect(checked('Report')).toBe('true');
  await view.rerender({ toggles: { report: false } });
  expect(checked('Report')).toBe('false');
  await view.rerender({ canEdit: false });
  expect(control.hasAttribute('disabled')).toBe(true);
  await fireEvent.click(control);
  await tick();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
