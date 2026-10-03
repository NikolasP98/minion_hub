import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMentionDirectory } from './mention-directory-resource';
import {
  decodeMentionDirectory,
  directoryOwner,
  DIRECTORY_BYTES,
  DIRECTORY_LIMIT,
  EMPTY_DIRECTORY,
  readMentionDirectory,
  type DirectoryOwner,
} from './mention-directory-wire';
import { renderMention } from '$lib/utils/mention';

const ACTOR = '10000000-0000-4000-8000-000000000001';
const PERSON = '10000000-0000-4000-8000-000000000002';
const A = { actorId: ACTOR, organizationId: '20000000-0000-4000-8000-000000000001' };
const B = { actorId: ACTOR, organizationId: '20000000-0000-4000-8000-000000000002' };
const payload = (owner = A, alias = 'colleague') => ({ ...owner, aliases: { [PERSON]: alias } });
const response = (owner = A, alias = 'colleague') => Response.json(payload(owner, alias));
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

function harness() {
  let owner: DirectoryOwner | null = A;
  const requests: ReturnType<typeof deferred<Response>>[] = [];
  const fetch = vi.fn((_signal: AbortSignal) => {
    const request = deferred<Response>();
    requests.push(request);
    return request.promise;
  });
  const report = vi.fn();
  const changed = vi.fn();
  const resource = createMentionDirectory({
    fetch,
    report,
    changed,
    currentOwner: () => owner,
    now: () => Date.now(),
  });
  return {
    resource,
    fetch,
    report,
    changed,
    requests,
    setOwner: (next: DirectoryOwner | null) => {
      owner = next;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('mention directory wire boundary', () => {
  it('returns an immutable inverse map with compatible mention escaping', () => {
    const view = decodeMentionDirectory(payload(), A);
    expect([...view]).toEqual([['colleague', PERSON]]);
    expect(view.has('colleague')).toBe(true);
    expect([...view.keys()]).toEqual(['colleague']);
    expect([...view.values()]).toEqual([PERSON]);
    expect(Reflect.get(view, 'set')).toBeUndefined();
    expect(Reflect.get(view, 'clear')).toBeUndefined();
    expect(Object.isFrozen(view)).toBe(true);
    view.forEach((value, alias, observed) => {
      expect(observed).toBe(view);
      expect(value).toBe(PERSON);
      expect(alias).toBe('colleague');
    });
    expect(renderMention('<b>@colleague</b> @unknown', view)).toBe(
      `&lt;b&gt;<span class="mention" data-user-id="${PERSON}">@colleague</span>&lt;/b&gt; @unknown`,
    );
  });

  it.each([
    null,
    [],
    {},
    { ...payload(), extra: true },
    { ...payload(), actorId: PERSON },
    payload(B),
    { ...A, aliases: [] },
    { ...A, aliases: { invalid: 'name' } },
    { ...A, aliases: { [PERSON]: '<script>' } },
    { ...A, aliases: { [PERSON]: 42 } },
    { ...A, aliases: { [PERSON]: 'same', [ACTOR]: 'same' } },
  ])('rejects malformed, foreign or ambiguous data %#', (raw) => {
    expect(() => decodeMentionDirectory(raw, A)).toThrow();
  });

  it('rejects the entry over the finite directory bound', () => {
    const aliases = Object.fromEntries(
      Array.from({ length: DIRECTORY_LIMIT + 1 }, (_, i) => [
        `30000000-0000-4000-8000-${i.toString().padStart(12, '0')}`,
        `person_${i}`,
      ]),
    );
    expect(() => decodeMentionDirectory({ ...A, aliases }, A)).toThrow('too-large');
  });

  it('admits an empty directory and requires actual owner IDs', () => {
    expect(decodeMentionDirectory({ ...A, aliases: {} }, A).size).toBe(0);
    expect(directoryOwner(ACTOR, A.organizationId)).toEqual(A);
    expect(directoryOwner('', A.organizationId)).toBeNull();
    expect(directoryOwner(ACTOR, undefined)).toBeNull();
  });

  it('counts streamed bytes despite a misleading Content-Length', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(DIRECTORY_BYTES));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    await expect(
      readMentionDirectory(
        new Response(stream, { headers: { 'Content-Length': '0' } }),
        A,
        new AbortController().signal,
      ),
    ).rejects.toThrow('too-large');
  });

  it.each([
    new Response('bad json'),
    new Response(new Uint8Array([255])),
    new Response(null),
    new Response('{}', { status: 503 }),
  ])('contains invalid JSON, encoding, empty bodies and HTTP failures %#', async (reply) => {
    await expect(readMentionDirectory(reply, A, new AbortController().signal)).rejects.toThrow();
  });
});

describe('owned mention directory observation', () => {
  it('coalesces simultaneous reads and caches only successful data', async () => {
    const h = harness();
    const first = h.resource.ensure(A);
    expect(h.resource.ensure(A)).toBe(first);
    await Promise.resolve();
    expect(h.fetch).toHaveBeenCalledTimes(1);
    h.requests[0].resolve(response());
    expect((await first).get('colleague')).toBe(PERSON);
    expect((await h.resource.ensure(A)).get('colleague')).toBe(PERSON);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    h.resource.dispose();
  });

  it('hides prior-owner data before the owner effect and rejects reversed completions', async () => {
    const h = harness();
    const first = h.resource.ensure(A);
    await Promise.resolve();
    h.setOwner(B);
    expect(h.resource.read(B)).toBe(EMPTY_DIRECTORY);
    const second = h.resource.ensure(B);
    await Promise.resolve();
    expect(await first).toBe(EMPTY_DIRECTORY);
    h.requests[1].resolve(response(B, 'current'));
    await second;
    h.requests[0].resolve(response(A, 'old'));
    await Promise.resolve();
    await Promise.resolve();
    expect([...h.resource.read(B)]).toEqual([['current', PERSON]]);
    h.resource.dispose();
  });

  it('A→B→A and stale finalizers cannot join or clear a new request', async () => {
    const h = harness();
    const oldA = h.resource.ensure(A);
    await Promise.resolve();
    h.setOwner(B);
    const oldB = h.resource.ensure(B);
    await Promise.resolve();
    h.setOwner(A);
    const newA = h.resource.ensure(A);
    await Promise.resolve();
    expect(await oldA).toBe(EMPTY_DIRECTORY);
    expect(await oldB).toBe(EMPTY_DIRECTORY);
    h.requests[0].resolve(response(A, 'retired'));
    h.requests[1].reject(new Error('private old failure'));
    await Promise.resolve();
    await Promise.resolve();
    expect(h.resource.ensure(A)).toBe(newA);
    expect(h.fetch).toHaveBeenCalledTimes(3);
    h.requests[2].resolve(response(A, 'fresh'));
    await newA;
    expect([...h.resource.read(A).keys()]).toEqual(['fresh']);
    expect(h.report).not.toHaveBeenCalled();
    h.resource.dispose();
  });

  it('confirmed invalidation retires an in-flight read and wakes a fresh generation', async () => {
    const h = harness();
    const old = h.resource.ensure(A);
    await Promise.resolve();
    h.resource.invalidate();
    const fresh = h.resource.ensure(A);
    await Promise.resolve();
    expect(await old).toBe(EMPTY_DIRECTORY);
    h.requests[0].resolve(response(A, 'obsolete'));
    await Promise.resolve();
    expect(h.resource.ensure(A)).toBe(fresh);
    h.requests[1].resolve(response(A, 'renamed'));
    await fresh;
    expect([...h.resource.read(A).keys()]).toEqual(['renamed']);
    h.resource.dispose();
  });

  it('settles a noncooperative timeout, rejects its late response and bounds retry', async () => {
    vi.useFakeTimers();
    const h = harness();
    const hung = h.resource.ensure(A);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await hung).toBe(EMPTY_DIRECTORY);
    expect(h.report).toHaveBeenCalledExactlyOnceWith('timeout');
    expect(await h.resource.ensure(A)).toBe(EMPTY_DIRECTORY);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    h.requests[0].resolve(response(A, 'late'));
    await Promise.resolve();
    expect(h.resource.read(A)).toBe(EMPTY_DIRECTORY);
    await vi.advanceTimersByTimeAsync(30_000);
    const retry = h.resource.ensure(A);
    await Promise.resolve();
    h.requests[1].resolve(response());
    await retry;
    expect(h.resource.read(A).get('colleague')).toBe(PERSON);
    h.resource.dispose();
  });

  it('a rejected read settles safely, with categorical rate-limited monitoring', async () => {
    vi.useFakeTimers();
    const h = harness();
    const failed = h.resource.ensure(A);
    await Promise.resolve();
    h.requests[0].reject(new Error('private alias, URL and credential must not be forwarded'));
    expect(await failed).toBe(EMPTY_DIRECTORY);
    expect(h.report).toHaveBeenCalledExactlyOnceWith('unavailable');
    h.resource.invalidate();
    const retry = h.resource.ensure(A);
    await Promise.resolve();
    h.requests[1].resolve(Response.json(payload(B)));
    expect(await retry).toBe(EMPTY_DIRECTORY);
    expect(h.report).toHaveBeenCalledTimes(1);
    h.resource.dispose();
  });

  it('expires successful data and retires immediately on missing identity or teardown', async () => {
    vi.useFakeTimers();
    const h = harness();
    const first = h.resource.ensure(A);
    await Promise.resolve();
    h.requests[0].resolve(response());
    await first;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(h.resource.read(A)).toBe(EMPTY_DIRECTORY);
    const refresh = h.resource.ensure(A);
    await Promise.resolve();
    h.setOwner(null);
    expect(await h.resource.ensure(null)).toBe(EMPTY_DIRECTORY);
    expect(await refresh).toBe(EMPTY_DIRECTORY);
    h.setOwner(A);
    const last = h.resource.ensure(A);
    await Promise.resolve();
    h.resource.dispose();
    expect(await last).toBe(EMPTY_DIRECTORY);
    expect(await h.resource.ensure(A)).toBe(EMPTY_DIRECTORY);
  });

  it('observer and monitoring exceptions cannot reject a read', async () => {
    const resource = createMentionDirectory({
      currentOwner: () => A,
      fetch: async () => {
        throw new Error('network');
      },
      changed: () => {
        throw new Error('observer');
      },
      report: () => {
        throw new Error('monitor');
      },
    });
    expect(await resource.ensure(A)).toBe(EMPTY_DIRECTORY);
    resource.dispose();
  });
});
