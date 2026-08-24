import { describe, it, expect, vi } from 'vitest';
import { createServerTimingHandle, ServerTiming } from './server-timing';

function fakeEvent(pathname: string, routeId: string | null = '/(app)/home') {
  return {
    url: new URL(`https://hub.test${pathname}`),
    route: { id: routeId },
    request: new Request(`https://hub.test${pathname}`),
  } as never;
}

const resolveOk = async () => new Response('ok', { status: 200 });

describe('createServerTimingHandle', () => {
  it('sets a Server-Timing header on every response', async () => {
    const handle = createServerTimingHandle({ sampleRate: 0, capture: vi.fn() });
    const res = await handle({ event: fakeEvent('/en/home'), resolve: resolveOk } as never);
    expect(res.headers.get('Server-Timing')).toMatch(/^app;dur=\d+$/);
  });

  it('preserves route-specific timing entries when adding the total app duration', async () => {
    const handle = createServerTimingHandle({ sampleRate: 0, capture: vi.fn() });
    const res = await handle({
      event: fakeEvent('/en/crm/customers'),
      resolve: async () => new Response('ok', { headers: { 'Server-Timing': 'crm_rank;dur=12' } }),
    } as never);
    expect(res.headers.get('Server-Timing')).toMatch(/^crm_rank;dur=12, app;dur=\d+$/);
  });

  it('captures a sampled server_timing event with route + duration + status', async () => {
    const capture = vi.fn();
    const handle = createServerTimingHandle({ sampleRate: 0.5, capture, random: () => 0.1 });
    await handle({ event: fakeEvent('/en/home'), resolve: resolveOk } as never);
    expect(capture).toHaveBeenCalledOnce();
    const [name, props] = capture.mock.calls[0];
    expect(name).toBe('server_timing');
    expect(props.route).toBe('/(app)/home');
    expect(props.status).toBe(200);
    expect(typeof props.duration_ms).toBe('number');
  });

  it('does not capture when the sample misses', async () => {
    const capture = vi.fn();
    const handle = createServerTimingHandle({ sampleRate: 0.5, capture, random: () => 0.9 });
    const res = await handle({ event: fakeEvent('/en/home'), resolve: resolveOk } as never);
    expect(capture).not.toHaveBeenCalled();
    // header still present — sampling only gates the analytics event
    expect(res.headers.get('Server-Timing')).toMatch(/^app;dur=\d+$/);
  });

  it('skips the /ingest telemetry proxy entirely', async () => {
    const capture = vi.fn();
    const handle = createServerTimingHandle({ sampleRate: 1, capture, random: () => 0 });
    const res = await handle({ event: fakeEvent('/ingest/e', null), resolve: resolveOk } as never);
    expect(capture).not.toHaveBeenCalled();
    expect(res.headers.get('Server-Timing')).toBeNull();
  });

  it('survives a response whose headers refuse mutation', async () => {
    const capture = vi.fn();
    const handle = createServerTimingHandle({ sampleRate: 1, capture, random: () => 0 });
    const frozen = new Response(null, { status: 302 });
    Object.defineProperty(frozen, 'headers', {
      value: {
        set: () => {
          throw new TypeError('immutable');
        },
        get: () => null,
      },
    });
    const res = await handle({ event: fakeEvent('/en/x'), resolve: async () => frozen } as never);
    expect(res.status).toBe(302);
    expect(capture).toHaveBeenCalledOnce(); // event still recorded
  });
});

describe('ServerTiming', () => {
  it('measures named stages and serializes a response header', async () => {
    const ticks = [10, 22];
    const timing = new ServerTiming(() => ticks.shift() ?? 22);
    await expect(timing.measure('crm_rank', async () => 'rows')).resolves.toBe('rows');
    expect(timing.headerValue()).toBe('crm_rank;dur=12');
  });
});
