// @vitest-environment happy-dom
//
// Slice 1 of specs/2026-08-21-hub-datatable-server-mode-test-gap-spec.md: the
// component-test environment foundation. This file establishes (not yet
// exercises server mode — that's Slice 2, out of scope here):
//   1. An isolated @testing-library/svelte render of the shared Button proving
//      the happy-dom mount crash (TypeError on Node.nextSibling inside Button's
//      insertion effect, see the spec's §0) is fixed by the happy-dom
//      15.11.7 → 20.11.6 bump — no jsdom fallback or @minion-stack/ui edit needed.
//   2. A file-local `vi.mock('$app/environment', ...)` that flips `browser` to
//      true only for this file, proving DataTable's row virtualization (gated
//      on `browser && wrapperEl`) can initialize under test.
//   3. A DataTable smoke render under that override, asserting a real body row
//      renders — proof the override actually reaches the component.
//
// TODO(handoff): Slice 2 (DataTable server-mode DOM coverage) cannot proceed
// as scoped by the spec — `DataTable.svelte` has no `server`/`onQuery` prop
// anywhere in this checkout (verified via `rg onQuery src`, zero hits). The
// spec's §2 "Verified AS-IS" carries this from the proposal as already-shipped
// by `2026-08-13-crm-customers-server-pagination-spec` §S4; that claim is
// stale in this branch. A human needs to reconcile whether S4 was reverted,
// never merged to this branch, or the spec's premise needs correction before
// Slice 2 can be attempted — see specs/2026-08-21-hub-datatable-server-mode-test-gap-spec.md.
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { Button } from '$lib/components/ui';
import type { DataColumn } from './DataTable.svelte';
import DataTable from './DataTable.svelte';

describe('shared Button DOM mount (happy-dom)', () => {
  test('renders cleanly and exposes its accessible role/name', () => {
    const { getByRole, unmount } = render(Button, {
      props: { 'aria-label': 'Save changes' },
    });

    const btn = getByRole('button', { name: 'Save changes' });
    expect(btn).toBeTruthy();
    expect(btn.tagName).toBe('BUTTON');

    // Clean teardown: unmounting must not throw (this is exactly the insertion-
    // effect path that crashed happy-dom pre-bump).
    expect(() => unmount()).not.toThrow();
  });
});

vi.mock('$app/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$app/environment')>();
  // DataTable's row virtualization only initializes `if (browser && wrapperEl)`
  // (DataTable.svelte's `rowVirt` derivation) — force it on for this file only
  // so DOM-mount tests can observe real rendered rows. The suite-wide default
  // stub (src/server/test-utils/env-stubs/app-environment.ts) stays `false`.
  return { ...actual, browser: true };
});

type Row = { id: string; name: string };

const columns: DataColumn<Row>[] = [{ key: 'name', label: 'Name' }];
const rows: Row[] = [
  { id: '1', name: 'Alice' },
  { id: '2', name: 'Bob' },
];

describe('DataTable DOM smoke (browser=true override)', () => {
  // @tanstack/virtual-core measures the scroll container via `offsetWidth`/
  // `offsetHeight` (see @tanstack/virtual-core's `getRect`), which happy-dom
  // never lays out (always 0) — a 0-height viewport makes the virtualizer
  // compute zero visible rows regardless of `browser`/`wrapperEl`. Stub both
  // to a real size so the initial (synchronous, pre-ResizeObserver) measurement
  // sees a non-empty viewport.
  const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');

  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      value: 600,
    });
  });

  afterAll(() => {
    if (offsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidth);
    if (offsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight);
  });

  test('renders at least one real body row once virtualization initializes', async () => {
    const { findAllByRole } = render(DataTable<Row>, {
      props: {
        data: rows,
        columns,
        getRowId: (row: Row) => row.id,
      },
    });

    const cells = await findAllByRole('cell', { name: 'Alice' });
    expect(cells.length).toBeGreaterThanOrEqual(1);
  });
});
