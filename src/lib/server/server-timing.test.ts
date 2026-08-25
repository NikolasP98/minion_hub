import { describe, it, expect, vi } from 'vitest';
import { createServerTimingHandle, ServerTiming } from './server-timing';

function fakeEvent(pathname: string, routeId: string | null = '/(app)/home') {
  return {
    url: new URL(`https://hub.test${pathname}`),
    route: { id: routeId },
    request: new Request(`https://hub.test${pathname}`),
    locals: { orgId: 'org-test' },
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

  it('captures org-scoped route-template telemetry without the raw path', async () => {
    const capture = vi.fn();
    const handle = createServerTimingHandle({ sampleRate: 0.5, capture, random: () => 0.1 });
    await handle({
      event: fakeEvent('/en/crm/customers/customer-secret', '/(app)/crm/customers/[id]'),
      resolve: resolveOk,
    } as never);
    expect(capture).toHaveBeenCalledOnce();
    const [name, props] = capture.mock.calls[0];
    expect(name).toBe('server_timing');
    expect(props.route).toBe('/(app)/crm/customers/[id]');
    expect(props.org_id).toBe('org-test');
    expect(props).not.toHaveProperty('path');
    expect(props.status).toBe(200);
    expect(typeof props.duration_ms).toBe('number');
    expect(capture.mock.calls[0][2]).toBe('org-test');
  });

  it('does not capture when the sample misses', async () => {
    const capture = vi.fn();
    const handle = createServerTimingHandle({ sampleRate: 0.5, capture, random: () => 0.9 });
    const res = await handle({ event: fakeEvent('/en/home'), resolve: resolveOk } as never);
    expect(capture).not.toHaveBeenCalled();
    // header still present — sampling only gates the analytics event
    expect(res.headers.get('Server-Timing')).toMatch(/^app;dur=\d+$/);
  });

  it('always captures and persists true isolate-cold requests', async () => {
    const capture = vi.fn();
    const persist = vi.fn();
    const ticks = [10, 44];
    const handle = createServerTimingHandle({
      sampleRate: 0,
      capture,
      persist,
      random: () => 1,
      now: () => ticks.shift() ?? 44,
      wallClock: () => 1_000,
      nextOrdinal: () => 1,
      instanceStartedAt: 900,
    });

    await handle({
      event: fakeEvent('/en/crm/insights', '/(app)/crm/insights'),
      resolve: resolveOk,
    } as never);

    expect(capture).toHaveBeenCalledOnce();
    expect(capture.mock.calls[0][1]).toMatchObject({
      sample_reason: 'isolate-cold',
      isolate_cold: true,
      request_ordinal: 1,
    });
    expect(persist).toHaveBeenCalledWith(
      'org-test',
      expect.objectContaining({
        route: '/(app)/crm/insights',
        isolateCold: true,
        durationMs: 34,
      }),
    );
  });

  it('always captures cache-miss cold paths and includes database stages', async () => {
    const capture = vi.fn();
    const persist = vi.fn();
    const ticks = [100, 250];
    const handle = createServerTimingHandle({
      sampleRate: 0,
      capture,
      persist,
      random: () => 1,
      now: () => ticks.shift() ?? 250,
      wallClock: () => 2_000,
      nextOrdinal: () => 12,
      instanceStartedAt: 500,
    });

    await handle({
      event: fakeEvent('/en/home'),
      resolve: async () => {
        const { recordCacheEvent, recordCacheLookup, recordDatabaseTiming } =
          await import('./performance-context');
        recordCacheEvent({ type: 'miss' });
        recordCacheLookup(17);
        recordDatabaseTiming({ acquireMs: 8, setupMs: 4, queryMs: 90, totalMs: 102 });
        return new Response('ok');
      },
    } as never);

    expect(capture.mock.calls[0][1]).toMatchObject({
      sample_reason: 'cache-miss',
      cache_status: 'miss',
      cache_lookup_ms: 17,
      db_query_ms: 90,
    });
    expect(persist.mock.calls[0][1]).toMatchObject({
      cache: { status: 'miss', misses: 1 },
      database: { transactions: 1, queryMs: 90 },
    });
  });

  it('still persists the durable sample when analytics capture throws', async () => {
    const persist = vi.fn();
    const handle = createServerTimingHandle({
      sampleRate: 1,
      capture: () => {
        throw new Error('analytics unavailable');
      },
      persist,
      random: () => 0,
      nextOrdinal: () => 9,
    });

    await handle({ event: fakeEvent('/en/home'), resolve: resolveOk } as never);

    expect(persist).toHaveBeenCalledOnce();
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
