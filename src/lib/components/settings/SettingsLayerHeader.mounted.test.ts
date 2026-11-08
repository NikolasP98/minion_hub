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
vi.mock('$app/stores', async () => {
  const { readable } = await import('svelte/store');
  return { page: readable(context.page) };
});
vi.mock('$lib/navigation', () => ({ goto: context.goto }));
vi.mock('$lib/access/can.svelte', () => ({ canViewPath: () => true }));
vi.mock('$lib/plugins/icon-map', () => ({ PLUGIN_ICON_MAP: {} }));
// Keep the real shared Button/Spinner and Paraglide pipeline. Unrelated UI
// exports and decorative icon modules are outside this link regression.
vi.mock('$lib/components/ui', async () => {
  const { Button, Spinner } = await import('@minion-stack/ui');
  const { iconSizes } = await import('$lib/components/ui/icon-sizes');
  return { Button, Spinner, iconSizes };
});
vi.mock('lucide-svelte', async () => ({
  ArrowLeft: (await import('./SettingsBackIcon.fixture.svelte')).default,
}));
vi.mock('$lib/paraglide/messages', () => ({
  common_back: () => 'Back',
  settings_title: () => 'Settings',
}));
import { settingsLayer } from '$lib/nav/settings-layer.svelte';
import { setLanguageTag } from '$lib/paraglide/runtime';
import SettingsLayerHeader from './SettingsLayerHeader.svelte';
import SettingsBackTranslation from './SettingsBackTranslation.fixture.svelte';
afterEach(cleanup);
beforeEach(() => {
  setLanguageTag('es');
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
    expect(view.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe('/es/account/home');
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

  it.each([
    { current: 'en', remembered: 'en' },
    { current: 'es', remembered: 'es' },
    { current: 'en', remembered: 'es' },
    { current: 'es', remembered: 'en' },
  ] as const)(
    'keeps the $remembered return locale under the current $current app provider',
    ({ current, remembered }) => {
      setLanguageTag(current);
      context.page.url = new URL(`https://hub.test/${remembered}/pos/sell?session=one#cart`);
      settingsLayer.observe();
      context.page.url = new URL(`https://hub.test/${current}/settings/appearance`);
      settingsLayer.observe();
      const view = render(SettingsBackTranslation, { language: current });
      expect(view.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe(
        `/${remembered}/pos/sell?session=one#cart`,
      );
    },
  );

  it.each(['en', 'es'] as const)('localizes the %s direct-entry fallback once', (language) => {
    setLanguageTag(language);
    context.page.data.user.id = 'direct-entry';
    context.page.url = new URL(`https://hub.test/${language}/settings/appearance`);
    settingsLayer.reconcile();
    const view = render(SettingsBackTranslation, { language });
    expect(view.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe(
      `/${language}/account/home`,
    );
  });
});
