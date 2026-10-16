// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
const state = vi.hoisted(() => ({ invalidate: vi.fn() }));
vi.mock('$app/navigation', () => ({ invalidate: state.invalidate }));
import AvailabilityEditor from './AvailabilityEditor.svelte';
import * as m from '$lib/paraglide/messages';
const schedule = {
  scheduleId: 'schedule-a',
  timezone: 'UTC',
  updatedAt: '2026-10-16T00:00:00.000Z',
  rules: [],
};
beforeEach(() => {
  state.invalidate.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('AvailabilityEditor durable saves', () => {
  it('repairs only the refresh after an acknowledged write', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) =>
      Response.json({ updatedAt: '2026-10-16T00:00:00.001Z' }),
    );
    vi.stubGlobal('fetch', fetcher);
    state.invalidate.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const view = render(AvailabilityEditor, { props: { resourceId: 'resource-a', schedule } });
    await tick();
    expect(fetcher).not.toHaveBeenCalled();
    await fireEvent.click(view.getAllByRole('checkbox')[0]);
    await waitFor(() => expect(view.getByText(m.asyncAction_refreshing())).toBeTruthy());
    await fireEvent.click(view.getByRole('button', { name: m.record_retry() }));
    await waitFor(() => expect(state.invalidate).toHaveBeenCalledTimes(2));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('fences the old resource response and sends no initialization write after switching resource', async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn(
      (_input: RequestInfo | URL) =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    const view = render(AvailabilityEditor, { props: { resourceId: 'resource-a', schedule } });
    await fireEvent.click(view.getAllByRole('checkbox')[0]);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await view.rerender({
      resourceId: 'resource-b',
      schedule: { ...schedule, scheduleId: 'schedule-b' },
    });
    finish(Response.json({ updatedAt: '2026-10-16T00:00:00.001Z' }));
    await tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(String(fetcher.mock.calls[0][0])).toContain('/resource-a/');
    expect(state.invalidate).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      view
        .getAllByRole('checkbox')
        .every((control) => (control as HTMLInputElement).checked === false),
    ).toBe(true);
  });
});

it('sends a queued edit with the token the in-flight save produced, not the one at edit time', async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve) => {
        if (fetcher.mock.calls.length === 1) finish = resolve;
        else resolve(Response.json({ updatedAt: '2026-10-16T00:00:00.002Z' }));
        void init;
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  const view = render(AvailabilityEditor, { props: { resourceId: 'resource-a', schedule } });
  state.invalidate.mockImplementation(async () => {
    await view.rerender({
      resourceId: 'resource-a',
      schedule: { ...schedule, updatedAt: '2026-10-16T00:00:00.001Z' },
    });
  });
  const boxes = view.getAllByRole('checkbox');
  await fireEvent.click(boxes[0]);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  await fireEvent.click(boxes[1]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  finish(Response.json({ updatedAt: '2026-10-16T00:00:00.001Z' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  const bodies = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
  expect(bodies[0].expectedUpdatedAt).toBe('2026-10-16T00:00:00.000Z');
  expect(bodies[1].expectedUpdatedAt).toBe('2026-10-16T00:00:00.001Z');
  expect(bodies[1].rules).toHaveLength(2);
});

it('retains unknown after a matching read and never repeats the write', async () => {
  const fetcher = vi.fn(async () => {
    throw new TypeError('response lost');
  });
  vi.stubGlobal('fetch', fetcher);
  state.invalidate.mockResolvedValue(undefined);
  const view = render(AvailabilityEditor, { props: { resourceId: 'resource-a', schedule } });
  await fireEvent.click(view.getAllByRole('checkbox')[0]);
  await waitFor(() => expect(view.getByText(m.asyncAction_unknown())).toBeTruthy());
  await fireEvent.click(view.getByRole('button', { name: m.record_review_latest() }));
  await view.rerender({
    resourceId: 'resource-a',
    schedule: {
      ...schedule,
      rules: [{ days: [0], startTime: '09:00', endTime: '17:00', date: null }],
    },
  });
  expect(view.getByText(m.asyncAction_unknown())).toBeTruthy();
  expect(view.queryByRole('button', { name: m.record_retry() })).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
