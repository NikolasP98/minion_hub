// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
const context = vi.hoisted(() => ({
  page: {
    url: new URL('https://hub.test/es/pos/sell?session=one#cart'),
    data: { user: { id: 'owner' }, activeOrgId: 'org' },
    status: 200,
    error: null as { message: string } | null,
  },
  goto: vi.fn(async () => {}),
}));
vi.mock('$app/state', () => ({ page: context.page }));
vi.mock('$lib/navigation', () => ({ goto: context.goto }));
vi.mock('$lib/access/can.svelte', () => ({ canViewPath: () => true }));
import { settingsLayer } from '$lib/nav/settings-layer.svelte';
import SettingsLayerHeader from './SettingsLayerHeader.svelte';
afterEach(cleanup);
beforeEach(() => {
  context.goto.mockClear();
  context.page.status = 200;
  context.page.error = null;
  context.page.data.user.id = 'reset';
  settingsLayer.reconcile();
  context.page.data.user.id = 'owner';
  context.page.url = new URL('https://hub.test/es/pos/sell?session=one#cart');
  settingsLayer.observe();
  context.page.url = new URL('https://hub.test/es/settings/appearance');
  settingsLayer.observe();
});

describe('Settings Back uses the real layer owner', () => {
  it('keeps a real Back link while busy and does not consume the remembered location', () => {
    const view = render(SettingsLayerHeader, { busy: true });
    const back = view.getByRole('link', { name: 'Back' });
    expect(back.textContent).toContain('Settings');
    expect(back.getAttribute('href')).toBe('/es/pos/sell?session=one#cart');
    expect(settingsLayer.isOpen).toBe(true);
    expect(settingsLayer.returnHref()).toBe('/es/pos/sell?session=one#cart');
  });

  it('uses personal home after an actor change while the layer remains open', () => {
    context.page.data.user.id = 'replacement';
    settingsLayer.reconcile();
    const view = render(SettingsLayerHeader);
    expect(view.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe('/account/home');
  });

  it('keeps the last successful location when a known route renders an error', () => {
    context.page.url = new URL('https://hub.test/es/crm/deleted-record');
    context.page.status = 404;
    context.page.error = { message: 'Not found' };
    settingsLayer.observe();
    context.page.url = new URL('https://hub.test/es/settings/appearance');
    context.page.status = 200;
    context.page.error = null;
    settingsLayer.observe();
    const view = render(SettingsLayerHeader);
    expect(view.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe(
      '/es/pos/sell?session=one#cart',
    );
  });
});
