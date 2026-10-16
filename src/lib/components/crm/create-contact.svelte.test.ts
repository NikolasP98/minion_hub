import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContactFlow } from './create-contact.svelte';
afterEach(() => vi.unstubAllGlobals());
function setup() {
  let owner = 'a';
  const navigate = vi.fn().mockResolvedValue(undefined);
  const refresh = vi.fn().mockResolvedValue(undefined);
  const notify = vi.fn();
  const flow = createContactFlow({
    owner: () => owner,
    name: () => 'New contact',
    navigate,
    refresh,
    notify,
  });
  return { flow, navigate, refresh, notify, setOwner: (value: string) => (owner = value) };
}
describe('contact creation recovery', () => {
  it('requires another read for each uncertain attempt and never auto-replays', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('Lost response'));
    vi.stubGlobal('fetch', fetch);
    const { flow, refresh } = setup();
    await flow.run();
    expect(fetch).toHaveBeenCalledTimes(1);
    await flow.run();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(flow.recovery).toMatchObject({ kind: 'unknown', reviewed: true });
    await flow.run();
    expect(fetch).toHaveBeenCalledTimes(2);
    await flow.run();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('retries only navigation after acknowledged creation', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ contact: { id: 'created' } }));
    vi.stubGlobal('fetch', fetch);
    const { flow, navigate } = setup();
    navigate.mockRejectedValueOnce(new Error('Navigation failed'));
    await flow.run();
    await flow.run();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls).toEqual([['created'], ['created']]);
  });
  it('fences late navigation and notices across owners, retaining old-owner recovery', async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((r) => (resolve = r))),
    );
    const { flow, setOwner, navigate, notify } = setup();
    const pending = flow.run();
    setOwner('b');
    resolve(Response.json({ contact: { id: 'created' } }));
    await pending;
    expect(navigate).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(flow.recovery).toBeNull();
    setOwner('a');
    expect(flow.recovery?.id).toBe('created');
  });
  it('treats 5xx as unknown and malformed 2xx as acknowledged without identity', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 500 }))
        .mockResolvedValueOnce(Response.json({ contact: {} })),
    );
    const first = setup();
    await first.flow.run();
    expect(first.flow.recovery?.kind).toBe('unknown');
    const second = setup();
    await second.flow.run();
    expect(second.flow.recovery?.kind).toBe('created');
    expect(second.navigate).not.toHaveBeenCalled();
    await second.flow.run();
    expect(second.refresh).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('does not treat failed read reconciliation as reviewed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Lost response')));
    const { flow, refresh } = setup();
    await flow.run();
    refresh.mockRejectedValue(new Error('Read failed'));
    await flow.run();
    expect(flow.recovery?.reviewed).not.toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
