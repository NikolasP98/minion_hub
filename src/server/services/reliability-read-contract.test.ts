import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  reliabilityReadAdmissionSnapshot,
  withReliabilityReadAdmission,
} from './reliability-read-admission';
import {
  parseArchitectureReadQuery,
  parseCredentialHealthReadQuery,
  parseInsightsReadQuery,
  parseSkillStatsReadQuery,
} from './reliability-read-query';
import {
  boundedReliabilityJson,
  RELIABILITY_RESPONSE_MAX_BYTES,
} from './reliability-read-response';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

afterEach(() => vi.useRealTimers());

describe('reliability read query contracts', () => {
  it('preserves explicit zero and applies exact defaults', () => {
    const now = 10_000;
    expect(parseInsightsReadQuery(new URL('https://x.test/?serverId=s&from=0&to=0'), now)).toEqual({
      serverId: 's',
      from: 0,
      to: 0,
    });
    expect(parseSkillStatsReadQuery(new URL('https://x.test/?serverId=s'), now)).toMatchObject({
      serverId: 's',
      from: 0,
      to: now,
      limit: 200,
      summary: false,
    });
    expect(
      parseCredentialHealthReadQuery(new URL('https://x.test/?serverId=s'), now),
    ).toMatchObject({
      limit: 100,
    });
    expect(parseArchitectureReadQuery(new URL('https://x.test/'))).toBeUndefined();
  });

  it.each([
    '?serverId=s&serverId=s',
    '?serverId=s&unknown=1',
    '?serverId=s&from=NaN',
    '?serverId=s&from=1.5',
    '?serverId=s&from=-1',
    '?serverId=s&from=2&to=1',
    `?serverId=${'x'.repeat(257)}`,
  ])('rejects invalid insights input %s', (search) => {
    expect(() => parseInsightsReadQuery(new URL(`https://x.test/${search}`), 100)).toThrow();
  });

  it('rejects future, over-wide, invalid summary/limit and architecture parameters', () => {
    expect(() =>
      parseInsightsReadQuery(new URL('https://x.test/?serverId=s&from=0&to=60001'), 0),
    ).toThrow();
    expect(() =>
      parseInsightsReadQuery(
        new URL(`https://x.test/?serverId=s&from=0&to=${91 * 86_400_000}`),
        91 * 86_400_000,
      ),
    ).toThrow();
    expect(() =>
      parseSkillStatsReadQuery(new URL('https://x.test/?serverId=s&summary=TRUE'), 100),
    ).toThrow();
    expect(() =>
      parseSkillStatsReadQuery(new URL('https://x.test/?serverId=s&limit=2001'), 100),
    ).toThrow();
    expect(() => parseArchitectureReadQuery(new URL('https://x.test/?serverId=s'))).toThrow();
  });
});

describe('reliability observation admission', () => {
  it('retains a timed-out owner slot until underlying work actually settles', async () => {
    vi.useFakeTimers();
    const pending = deferred<string>();
    const first = withReliabilityReadAdmission('actor/target/timeout', () => pending.promise, 10);
    const rejected = expect(first).rejects.toMatchObject({
      status: 504,
      code: 'reliability_read_timeout',
    });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10);
    await rejected;
    expect(reliabilityReadAdmissionSnapshot().activeTotal).toBe(1);
    await expect(
      withReliabilityReadAdmission('actor/target/timeout', async () => 'duplicate', 10),
    ).rejects.toMatchObject({ status: 503, code: 'reliability_read_busy' });
    pending.resolve('late');
    await Promise.resolve();
    await Promise.resolve();
    expect(reliabilityReadAdmissionSnapshot().activeTotal).toBe(0);
  });

  it('caps process-wide work without an unbounded queue', async () => {
    const pending = Array.from({ length: 4 }, () => deferred<void>());
    const reads = pending.map((entry, index) =>
      withReliabilityReadAdmission(`actor/${index}`, () => entry.promise, 60_000),
    );
    await Promise.resolve();
    expect(reliabilityReadAdmissionSnapshot()).toEqual({ activeTotal: 4, activeKeys: 4 });
    await expect(
      withReliabilityReadAdmission('actor/fifth', async () => undefined),
    ).rejects.toMatchObject({ code: 'reliability_read_busy' });
    for (const entry of pending) entry.resolve();
    await Promise.all(reads);
    expect(reliabilityReadAdmissionSnapshot().activeTotal).toBe(0);
  });

  it('atomically collapses requested aliases onto one canonical actor-target slot', async () => {
    const pending = deferred<void>();
    const first = withReliabilityReadAdmission('requested/legacy', async (_signal, rekey) => {
      rekey('target/canonical');
      await pending.promise;
    });
    await Promise.resolve();

    await expect(
      withReliabilityReadAdmission('requested/uuid', async (_signal, rekey) => {
        rekey('target/canonical');
      }),
    ).rejects.toMatchObject({ status: 503, code: 'reliability_read_busy' });
    expect(reliabilityReadAdmissionSnapshot()).toEqual({ activeTotal: 1, activeKeys: 1 });

    pending.resolve();
    await first;
    expect(reliabilityReadAdmissionSnapshot()).toEqual({ activeTotal: 0, activeKeys: 0 });
  });
});

describe('bounded reliability responses', () => {
  it('uses exact UTF-8 bytes and private no-store headers', async () => {
    const response = boundedReliabilityJson({ value: 'á' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({ value: 'á' });
    expect(() =>
      boundedReliabilityJson({ value: 'x'.repeat(RELIABILITY_RESPONSE_MAX_BYTES) }),
    ).toThrow(/unavailable/);
  });
});
