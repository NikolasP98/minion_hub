// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import {
  installRoleSimulationClient,
  prepareAuthorityChange,
} from '$lib/services/role-simulation-client';
import { inactiveSimulation } from '$lib/role-simulation';
import AuthorityRetirement from './AuthorityRetirement.svelte';

let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});
afterEach(() => {
  dispose?.();
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('retired application recovery', () => {
  it('conceals the old document and native overlays before failed navigation, with a read-only Refresh recovery', async () => {
    let complete!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      complete = resolve;
    });
    const network = vi
      .fn<typeof fetch>()
      .mockImplementation((input) =>
        String(input) === '/api/old-record'
          ? pending
          : Promise.resolve(new Response('{"ok":true}')),
      );
    vi.stubGlobal('fetch', network);
    window.fetch = network;
    const navigate = vi.fn().mockImplementationOnce(() => {
      throw new Error('navigation blocked');
    });
    const view = render(AuthorityRetirement, { active: false });
    const dialog = document.createElement('dialog');
    dialog.open = true;
    document.body.append(dialog);
    const retireQueryAndGateway = vi.fn(() => {
      void view.rerender({ active: true });
    });
    dispose = installRoleSimulationClient({
      readState: () => inactiveSimulation(),
      readOwner: () => 'actor:org',
      navigate,
      onRetire: retireQueryAndGateway,
    });
    const oldRead = window.fetch('/api/old-record');
    const rejectedRead = expect(oldRead).rejects.toMatchObject({ name: 'AbortError' });
    const preparing = prepareAuthorityChange();
    await vi.advanceTimersByTimeAsync(600);
    const change = await preparing;
    await change.fetch('/api/nav/access', { method: 'PUT', body: '{}' });
    expect(() => change.commit('/en/crm')).toThrow('navigation blocked');
    await vi.advanceTimersByTimeAsync(1);
    expect(document.documentElement.hasAttribute('data-authority-retiring')).toBe(true);
    expect(dialog.open).toBe(false);
    expect(retireQueryAndGateway).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledOnce();
    complete(new Response('{"oldPrivateRecord":true}'));
    await rejectedRead;
    const refresh = screen.getByRole('button', { name: 'Refresh page' });
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    await fireEvent.click(refresh);
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenLastCalledWith('/en/crm');
    expect(
      network.mock.calls.filter(
        ([input, init]) => String(input) === '/api/nav/access' && init?.method === 'PUT',
      ),
    ).toHaveLength(1);
    expect(document.documentElement.hasAttribute('data-authority-retiring')).toBe(true);
    dialog.remove();
  });
});
