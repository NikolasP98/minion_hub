// @vitest-environment happy-dom
/**
 * Spec 045 T034: a plugin page renders its iframe with no gateway token. The
 * bridge hello carries `authToken: ''` and nothing asks the token endpoint.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { mountHostBridge } from './bridge-host';
import PluginControlCenter from './PluginControlCenter.svelte';

vi.mock('./bridge-host', () => ({
  mountHostBridge: vi.fn(() => ({
    dispose: vi.fn(),
    sendThemeChange: vi.fn(),
    sendLocaleChange: vi.fn(),
    requestSave: vi.fn(),
    bridge: {},
  })),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('mounts the plugin iframe with an empty authToken and fetches no token', async () => {
  const fetchSpy = vi.fn(async (_url: RequestInfo | URL) => new Response('{}'));
  vi.stubGlobal('fetch', fetchSpy);
  const { container } = render(PluginControlCenter, {
    entry: {
      pluginId: 'demo',
      slot: 'nav',
      title: 'Demo',
      description: 'Demo plugin',
      entrypoint: 'index.html',
      status: 'loaded',
    } as never,
    gatewayBaseUrl: 'https://gw.invalid',
  });
  await tick();

  expect(container.querySelector('iframe')).not.toBeNull();
  expect(mountHostBridge).toHaveBeenCalledWith(
    expect.objectContaining({ hello: expect.objectContaining({ authToken: '' }) }),
  );
  expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('/token'))).toBe(false);
});
