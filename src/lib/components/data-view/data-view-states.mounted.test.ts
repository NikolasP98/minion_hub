// @vitest-environment happy-dom
/**
 * Spec 013 FR-005 — one collection-state presentation for every list. The
 * matrix mounts `CollectionState` in all nine states through a host that
 * places the state block above its rows the way a collection page does
 * (`DataView` stays headless), and proves that Retry is read-only: it reaches
 * `onRetry` exactly once and never a write callback the page handed in as a
 * create / clear-filters action.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import Harness from './__fixtures__/collection-state-harness.svelte';
import { COLLECTION_STATES, collectionShowsRows, type CollectionState } from './data-view';

afterEach(cleanup);

const STATE = '[data-component="collection-state"]';
const BOUNDARY = '[data-component="async-boundary"]';

function mount(state: CollectionState | undefined, message?: string) {
  const onRetry = vi.fn(() => Promise.resolve());
  const onWrite = vi.fn();
  const view = render(Harness, { state, message, onRetry, onWrite });
  const rows = () => view.queryByTestId('rows');
  const retryButton = () => view.queryByRole('button', { name: 'Retry' });
  return { view, onRetry, onWrite, rows, retryButton };
}

async function clickRetryOnce(t: ReturnType<typeof mount>) {
  const button = t.retryButton();
  expect(button).not.toBeNull();
  await fireEvent.click(button!);
  await waitFor(() => expect(t.onRetry).toHaveBeenCalledTimes(1));
  expect(t.onWrite).not.toHaveBeenCalled();
}

describe('CollectionState matrix', () => {
  it('renders nothing extra for callers without a state (today’s behaviour)', () => {
    const t = mount(undefined);
    expect(t.view.container.querySelector(STATE)).toBeNull();
    expect(t.view.container.querySelector(BOUNDARY)).toBeNull();
    expect(t.rows()?.textContent).toContain('alpha');
  });

  it('initial-load: skeleton rows in the table shape, rows hidden, no spinner', () => {
    const t = mount('initial-load');
    const region = t.view.container.querySelector<HTMLElement>(STATE)!;
    expect(region.dataset.state).toBe('initial-load');
    expect(region.getAttribute('aria-busy')).toBe('true');
    expect(region.querySelectorAll('[data-component="skeleton-compat"]').length).toBe(6);
    expect(t.view.container.querySelector('[data-part="spinner"]')).toBeNull();
    expect(t.rows()).toBeNull();
  });

  it('refreshing: keeps the previous rows visible beside one xs spinner caption', () => {
    const t = mount('refreshing');
    // Negative control: a refresh must never blank the list.
    expect(t.rows()?.querySelectorAll('li').length).toBe(2);
    expect(t.view.container.querySelectorAll('[data-part="spinner"]').length).toBe(1);
    expect(t.view.container.querySelector(STATE)?.textContent).toContain('Refreshing');
    expect(t.view.container.querySelector(BOUNDARY)).toBeNull();
    expect(t.retryButton()).toBeNull();
  });

  it('stale: rows + age caption + read-only Retry', async () => {
    const t = mount('stale', 'Last updated 5 min ago');
    expect(t.rows()).not.toBeNull();
    expect(t.view.container.querySelector(STATE)?.textContent).toContain('Last updated 5 min ago');
    await clickRetryOnce(t);
  });

  it('empty: EmptyState with the create action, rows hidden', () => {
    const t = mount('empty');
    const boundary = t.view.container.querySelector<HTMLElement>(BOUNDARY)!;
    expect(boundary.dataset.state).toBe('empty');
    expect(boundary.textContent).toContain('Nothing here yet');
    expect(t.view.getByTestId('create')).toBeTruthy();
    expect(t.view.queryByTestId('clear')).toBeNull();
    expect(t.rows()).toBeNull();
    expect(t.retryButton()).toBeNull();
  });

  it('no-results: filtered-empty copy with the clear-filters action only', () => {
    const t = mount('no-results');
    expect(t.view.container.querySelector(BOUNDARY)?.textContent).toContain(
      'No results for these filters',
    );
    expect(t.view.getByTestId('clear')).toBeTruthy();
    expect(t.view.queryByTestId('create')).toBeNull();
    expect(t.rows()).toBeNull();
  });

  it('denied: names the role and the subject, offers no Retry', () => {
    const t = mount('denied', 'customers');
    const boundary = t.view.container.querySelector<HTMLElement>(BOUNDARY)!;
    expect(boundary.dataset.state).toBe('forbidden');
    expect(boundary.textContent).toContain("Your role can't view customers.");
    expect(t.retryButton()).toBeNull();
    expect(t.rows()).toBeNull();
  });

  it('partial: rows + warning banner naming what failed + Retry', async () => {
    const t = mount('partial', 'finance totals');
    expect(t.rows()).not.toBeNull();
    const banner = t.view.container.querySelector<HTMLElement>(STATE)!;
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toContain('finance totals');
    await clickRetryOnce(t);
  });

  it('failed: error notice + Retry, rows hidden because nothing ever loaded', async () => {
    const t = mount('failed');
    const boundary = t.view.container.querySelector<HTMLElement>(BOUNDARY)!;
    expect(boundary.dataset.state).toBe('error');
    expect(boundary.textContent).toContain("couldn't be loaded");
    expect(t.rows()).toBeNull();
    await clickRetryOnce(t);
  });

  it('recovered: rows + a brief updated caption', () => {
    const t = mount('recovered');
    expect(t.rows()).not.toBeNull();
    expect(t.view.container.querySelector(STATE)?.textContent?.trim()).toBe('Updated');
    expect(t.retryButton()).toBeNull();
  });

  it('every state is covered by the matrix and the rows rule', () => {
    expect(COLLECTION_STATES).toHaveLength(9);
    expect(COLLECTION_STATES.filter((s) => collectionShowsRows(s))).toEqual([
      'refreshing',
      'stale',
      'partial',
      'recovered',
    ]);
    expect(collectionShowsRows(undefined)).toBe(true);
  });
});
