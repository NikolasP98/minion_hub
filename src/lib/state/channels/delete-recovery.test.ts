import { afterEach, describe, expect, it, vi } from 'vitest';
import { channelState, deleteChannel } from './channels.svelte';
import { ApiError } from '$lib/api/fetch-json';
afterEach(() => vi.unstubAllGlobals());
describe('channel deletion acknowledgement', () => {
  it('does not turn a failed refresh into a retryable delete', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockRejectedValueOnce(new Error('Read failed'));
    vi.stubGlobal('fetch', fetch);
    await expect(deleteChannel('server', 'record')).resolves.toBeUndefined();
    expect(fetch.mock.calls.map((call) => call[1]?.method ?? 'GET')).toEqual(['DELETE', 'GET']);
    expect(channelState.error).toBe('Read failed');
  });
  it('fences projection changes and refresh when the owner changes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    channelState.selectedChannelId = 'record';
    await deleteChannel('server', 'record', () => false);
    expect(channelState.selectedChannelId).toBe('record');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('preserves explicit HTTP rejection and transport uncertainty', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response('{}', { status: 403, headers: { 'content-type': 'application/json' } }),
        )
        .mockRejectedValueOnce(new Error('Lost reply')),
    );
    await expect(deleteChannel('server', 'record')).rejects.toMatchObject({ status: 403 });
    await expect(deleteChannel('server', 'record')).rejects.toBeInstanceOf(ApiError);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
