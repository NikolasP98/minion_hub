import { describe, expect, it } from 'vitest';
import { channelHref, visibleLinkPlugins } from './channel-href';

describe('channelHref (spec 043)', () => {
  it('links gateway channels to comms settings without ai; Gmail stays', () => {
    expect(channelHref('whatsapp', false)).toBe('/settings?s=comms');
    expect(channelHref('gmail', false)).toBe('/channels/gmail');
  });
  it('is unchanged with ai', () => {
    expect(channelHref('whatsapp', true)).toBe('/channels/whatsapp');
  });
});

describe('visibleLinkPlugins (spec 043, /account/connections)', () => {
  const plugins = [
    { pluginId: 'a', link: { mode: 'iframe' } },
    { pluginId: 'b', link: { mode: 'qr' } },
    { pluginId: 'c', link: { mode: 'form' } },
  ];
  it('drops iframe entries without ai, keeps qr and form', () => {
    expect(visibleLinkPlugins(plugins, false).map((p) => p.pluginId)).toEqual(['b', 'c']);
  });
  it('keeps everything with ai', () => {
    expect(visibleLinkPlugins(plugins, true)).toEqual(plugins);
  });
});
