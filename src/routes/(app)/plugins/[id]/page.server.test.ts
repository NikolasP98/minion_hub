import { describe, it, expect, vi } from 'vitest';
import { load } from './+page.server';

vi.mock('$lib/server/gateway-rpc', () => ({
  pluginsUiList: vi.fn(async () => []),
  getGatewayHttpUrl: vi.fn(async () => 'http://gw'),
}));

describe('/plugins/[id] load', () => {
  it('throws 404 when no control-center entry matches id', async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      load({ params: { id: 'missing' }, url: new URL('http://h/plugins/missing') } as any),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('returns matching entry', async () => {
    const { pluginsUiList } = await import('$lib/server/gateway-rpc');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pluginsUiList as any).mockResolvedValueOnce([
      {
        pluginId: 'x',
        slot: 'plugins.controlCenter',
        title: 'X',
        description: 'd',
        entrypoint: 'c.html',
      },
      {
        pluginId: 'x',
        slot: 'settings.plugins',
        title: 'X',
        description: 'd',
        entrypoint: 'i.html',
      },
    ]);
    const result = await load(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { params: { id: 'x' }, url: new URL('http://h/plugins/x') } as any,
    );
    if (!result) throw new Error('expected load to return page data');
    expect(result.entry.entrypoint).toBe('c.html');
  });
});
