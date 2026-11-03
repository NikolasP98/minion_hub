// @vitest-environment happy-dom
/** Spec 045 T038 (H1): plugin channel entries drop out of the Channels nav; gmail stays. */
import { afterEach, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { env as publicEnv } from '$env/dynamic/public';
import { page } from '$app/state';
import ChannelsNav from './ChannelsNav.svelte';

const channels = [
  { pluginId: 'gmail', title: 'Gmail' },
  { pluginId: 'whatsapp-crm', title: 'WhatsApp CRM' },
];
const hrefs = (c: HTMLElement) => Array.from(c.querySelectorAll('a')).map((a) => a.getAttribute('href'));

afterEach(() => {
  cleanup();
  delete publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN;
  page.data = {};
});

it('member after the switch: only the hub-backed gmail page is offered', () => {
  publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN = 'false';
  page.data = { user: { role: 'user' } };
  const { container } = render(ChannelsNav, { channels });
  expect(hrefs(container).join(' ')).toContain('/channels/gmail');
  expect(hrefs(container).join(' ')).not.toContain('whatsapp-crm');
});

it('platform admin after the switch and a member with the flag unset see both', () => {
  publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN = 'false';
  page.data = { user: { role: 'admin' } };
  expect(hrefs(render(ChannelsNav, { channels }).container).join(' ')).toContain('whatsapp-crm');
  cleanup();
  delete publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN;
  page.data = { user: { role: 'user' } };
  expect(hrefs(render(ChannelsNav, { channels }).container).join(' ')).toContain('whatsapp-crm');
});
