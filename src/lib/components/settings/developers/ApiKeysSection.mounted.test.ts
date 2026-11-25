// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import * as m from '$lib/paraglide/messages';

vi.mock('$app/state', async () => {
  const { testPage } = await import('$lib/state/ui/__fixtures__/preference-owner.svelte');
  return {
    page: new Proxy(testPage, {
      get: (t, k) =>
        k === 'url' ? new URL('http://hub.test/settings/developers') : Reflect.get(t, k),
    }),
  };
});
vi.mock('$lib/navigation', () => ({
  invalidate: vi.fn(async () => {}),
  goto: vi.fn(async () => {}),
}));

import ApiKeysSection from './ApiKeysSection.svelte';

afterEach(cleanup);

const locksToggle = () => screen.getByRole('switch', { name: m.settings_developers_scope_locks() });
const isDisabled = (el: HTMLElement) =>
  el.getAttribute('aria-disabled') === 'true' || (el as HTMLButtonElement).disabled;

describe('ApiKeysSection locks scope (spec 140)', () => {
  it('a non-owner sees the "Record locks" scope disabled with the owner-only reason', async () => {
    render(ApiKeysSection, { keys: [], isOwner: false });
    await fireEvent.click(screen.getAllByRole('button', { name: m.settings_developers_new() })[0]!);
    expect(isDisabled(locksToggle())).toBe(true);
    expect(screen.getByText(m.settings_developers_locks_owner_required())).toBeTruthy();
  });

  it('an owner can switch it on', async () => {
    render(ApiKeysSection, { keys: [], isOwner: true });
    await fireEvent.click(screen.getAllByRole('button', { name: m.settings_developers_new() })[0]!);
    expect(isDisabled(locksToggle())).toBe(false);
  });
});
