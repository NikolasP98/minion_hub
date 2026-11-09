// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import type { PeekState } from './peek.svelte';

const harness = vi.hoisted(() => ({
  peek: undefined as PeekState | undefined,
  loads: vi.fn(),
  data: { user: { id: 'actor' }, activeOrgId: 'org', roleSimulation: { generation: 'initial' } },
}));
vi.mock('$app/state', () => ({
  page: {
    get data() {
      return harness.data;
    },
    get state() {
      return { peek: harness.peek };
    },
    url: new URL('http://localhost/en/crm'),
  },
}));
vi.mock('./peek-registry', () => ({
  resolvePeekPage: () => {
    harness.loads();
    return async () => ({ default: (await import('./testing/PeekAuthorityPage.svelte')).default });
  },
}));
import { currentPeekAuthorityKey, isCurrentPeek } from './peek.svelte';
import { retireRecordPeeks } from './peek-authority';
import RecordPeek from './RecordPeek.svelte';

const data = { title: 'Authorized record', secret: 'PRIVATE OWNER ROW' };
beforeEach(() => {
  harness.peek = undefined;
  harness.loads.mockReset();
  harness.data = {
    user: { id: 'actor' },
    activeOrgId: 'org',
    roleSimulation: { generation: 'initial' },
  };
  document.documentElement.removeAttribute('data-authority-retiring');
  retireRecordPeeks();
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});
afterEach(cleanup);

describe('raw history peek authority', () => {
  it('renders data only when it belongs to this document and current authority', async () => {
    harness.peek = {
      href: '/crm/one',
      mode: 'tray',
      data,
      authorityKey: currentPeekAuthorityKey()!,
    };
    render(RecordPeek);
    expect(await screen.findByText('PRIVATE OWNER ROW')).toBeTruthy();
    expect(harness.loads).toHaveBeenCalled();
  });

  it('never loads or renders a legacy history payload lacking an authority key', () => {
    harness.peek = { href: '/crm/one', mode: 'tray', data };
    render(RecordPeek);
    expect(screen.queryByText('PRIVATE OWNER ROW')).toBeNull();
    expect(harness.loads).not.toHaveBeenCalled();
  });

  it('rejects Back-restored raw data after retirement even with the same actor, organization and role generation', () => {
    const historical: PeekState = {
      href: '/crm/one',
      mode: 'tray',
      data,
      authorityKey: currentPeekAuthorityKey()!,
    };
    expect(isCurrentPeek(historical)).toBe(true);
    // Simulate restoration of the older history entry after its document/authority retired.
    retireRecordPeeks();
    harness.peek = historical;
    render(RecordPeek);
    expect(isCurrentPeek(historical)).toBe(false);
    expect(screen.queryByText('PRIVATE OWNER ROW')).toBeNull();
    expect(harness.loads).not.toHaveBeenCalled();
  });

  it.each(['actor', 'organization', 'generation'])(
    'rejects a raw payload after its %s changes',
    (changed) => {
      harness.peek = {
        href: '/crm/one',
        mode: 'tray',
        data,
        authorityKey: currentPeekAuthorityKey()!,
      };
      if (changed === 'actor') harness.data.user.id = 'different';
      if (changed === 'organization') harness.data.activeOrgId = 'different';
      if (changed === 'generation') harness.data.roleSimulation.generation = 'different';
      render(RecordPeek);
      expect(screen.queryByText('PRIVATE OWNER ROW')).toBeNull();
      expect(harness.loads).not.toHaveBeenCalled();
    },
  );
});
