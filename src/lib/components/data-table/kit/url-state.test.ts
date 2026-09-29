/**
 * `$app/state` is aliased to a stub by `vitest.config.ts`, so `page.url` is
 * overridden here with a mutable getter (the `can.svelte.test.ts` idiom) and
 * `$app/navigation` is mocked outright — it has no stub at all.
 *
 * `sync()` is called directly, never from an `$effect`: a bare `$effect` never
 * runs in this harness (see `scheduling/kit/settled-day.svelte.test.ts`), which
 * is exactly why the kit makes the mirror the consumer's effect rather than its
 * own. The one thing these tests therefore cannot prove is that a consumer
 * wired `$effect(() => url.sync())` — that is the slice's browser check.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTableUrlState } from './url-state.svelte';

const mocks = vi.hoisted(() => ({
  url: new URL('http://localhost/t'),
  replaceState: vi.fn(),
  goto: vi.fn(),
}));

vi.mock('$app/state', () => ({
  page: {
    get url() {
      return mocks.url;
    },
    data: {},
    params: {},
  },
}));
vi.mock('$app/navigation', () => ({ replaceState: mocks.replaceState, goto: mocks.goto }));

const ALL = ['search', 'sort', 'filters', 'page', 'expanded'] as const;

function at(search: string) {
  mocks.url = new URL(`http://localhost/t${search}`);
}
/** Let the queued microtask write. */
const flush = () => new Promise<void>((r) => queueMicrotask(r));
/** The params of the single write this test performed. */
async function written(): Promise<URLSearchParams> {
  await flush();
  expect(mocks.replaceState).toHaveBeenCalledTimes(1);
  const target = mocks.replaceState.mock.calls[0][0] as string;
  return new URL(target, 'http://localhost').searchParams;
}

beforeEach(() => {
  mocks.replaceState.mockClear();
  mocks.goto.mockClear();
  at('');
});

describe('createTableUrlState — write failures', () => {
  it('swallows a write that lands before the router is initialized, and writes on the next change', async () => {
    mocks.replaceState.mockImplementationOnce(() => {
      throw new Error('Cannot call replaceState(...) before router is initialized');
    });
    const s = createTableUrlState({ keys: ['sort'] });
    // A consumer seeding its default sort syncs from a MOUNT-time effect.
    s.sort = [{ key: 'score', dir: 'desc' }];
    s.sync();
    await flush();
    expect(mocks.replaceState).toHaveBeenCalledTimes(1);

    // Nothing was remembered as written, so the next change carries the state.
    s.search = 'ignored-key';
    s.sort = [{ key: 'name', dir: 'asc' }];
    s.sync();
    await flush();
    expect(mocks.replaceState).toHaveBeenCalledTimes(2);
    expect(mocks.replaceState.mock.calls[1][0]).toBe('/t?sort=name%3Aasc');
  });
});

describe('createTableUrlState — parse', () => {
  it('reads every key off page.url', () => {
    at('?q=ana&sort=name:asc,score:desc&f.stage=new,won&page=3&x=a,b');
    const s = createTableUrlState({ keys: [...ALL] });
    expect(s.search).toBe('ana');
    expect(s.sort).toEqual([
      { key: 'name', dir: 'asc' },
      { key: 'score', dir: 'desc' },
    ]);
    expect(s.filters).toEqual({ stage: ['new', 'won'] });
    expect(s.page).toBe(3);
    expect(s.expanded).toEqual(['a', 'b']);
  });

  it('reads min..max ranges, including open-ended ones', () => {
    at('?f.score=10..90&f.due=2026-01-01..&f.total=..500&f.blank=..');
    const s = createTableUrlState({ keys: ['filters'] });
    expect(s.filters).toEqual({
      score: { min: '10', max: '90' },
      due: { min: '2026-01-01' },
      total: { max: '500' },
    });
    expect(s.filters.blank).toBeUndefined();
  });

  it('defaults a dir-less sort entry to asc and drops junk', () => {
    at('?sort=name,:desc,,score:weird');
    const s = createTableUrlState({ keys: ['sort'] });
    expect(s.sort).toEqual([
      { key: 'name', dir: 'asc' },
      { key: 'score', dir: 'asc' },
    ]);
  });

  it('ignores params for keys it was not given', () => {
    at('?q=ana&page=4&x=a');
    const s = createTableUrlState({ keys: ['search'] });
    expect(s.search).toBe('ana');
    expect(s.page).toBe(1);
    expect(s.expanded).toEqual([]);
  });

  it('honours a prefix', () => {
    at('?aq=ana&asort=name:desc&af.stage=new&apage=2&ax=r1&q=other');
    const s = createTableUrlState({ keys: [...ALL], prefix: 'a' });
    expect(s.search).toBe('ana');
    expect(s.sort).toEqual([{ key: 'name', dir: 'desc' }]);
    expect(s.filters).toEqual({ stage: ['new'] });
    expect(s.page).toBe(2);
    expect(s.expanded).toEqual(['r1']);
  });

  it('clamps a missing or nonsense page to 1', () => {
    at('?page=0');
    expect(createTableUrlState({ keys: ['page'] }).page).toBe(1);
    at('?page=nope');
    expect(createTableUrlState({ keys: ['page'] }).page).toBe(1);
  });
});

describe('createTableUrlState — write', () => {
  it('round-trips every key through the URL', async () => {
    const s = createTableUrlState({ keys: [...ALL] });
    s.search = 'ana';
    s.sort = [
      { key: 'name', dir: 'asc' },
      { key: 'score', dir: 'desc' },
    ];
    s.filters = { stage: ['new', 'won'], score: { min: '10', max: '90' }, name: 'ana' };
    s.page = 3;
    s.expanded = ['a', 'b'];
    s.sync();

    const p = await written();
    expect(p.get('q')).toBe('ana');
    expect(p.get('sort')).toBe('name:asc,score:desc');
    expect(p.get('f.stage')).toBe('new,won');
    expect(p.get('f.score')).toBe('10..90');
    expect(p.get('f.name')).toBe('ana');
    expect(p.get('page')).toBe('3');
    expect(p.get('x')).toBe('a,b');

    at(`?${p}`);
    const back = createTableUrlState({ keys: [...ALL] });
    expect(back.search).toBe(s.search);
    expect(back.sort).toEqual(s.sort);
    expect(back.page).toBe(s.page);
    expect(back.expanded).toEqual(s.expanded);
    // A bare string comes back as a one-item list — documented on the type.
    expect(back.filters).toEqual({
      stage: ['new', 'won'],
      score: { min: '10', max: '90' },
      name: ['ana'],
    });
  });

  it('never writes an empty value', async () => {
    at('?q=ana&sort=name:asc&f.stage=new&page=4&x=a');
    const s = createTableUrlState({ keys: [...ALL] });
    s.search = '   ';
    s.sort = [];
    s.filters = { stage: [], score: {}, name: '' };
    s.page = 1;
    s.expanded = [];
    s.sync();

    const p = await written();
    expect([...p.keys()]).toEqual([]);
  });

  it('keeps every unrelated param', async () => {
    at('?tab=open&q=old&tag=t1');
    const s = createTableUrlState({ keys: ['search', 'filters'] });
    s.search = 'new';
    s.filters = { stage: ['won'] };
    s.sync();

    const p = await written();
    expect(p.get('tab')).toBe('open');
    expect(p.get('tag')).toBe('t1');
    expect(p.get('q')).toBe('new');
    expect(p.get('f.stage')).toBe('won');
  });

  it('drops a stale filter param it owns without touching foreign f.* keys', async () => {
    at('?f.stage=new&bf.stage=keep');
    const s = createTableUrlState({ keys: ['filters'] });
    s.filters = { funnel: ['lead'] };
    s.sync();

    const p = await written();
    expect(p.has('f.stage')).toBe(false);
    expect(p.get('f.funnel')).toBe('lead');
    expect(p.get('bf.stage')).toBe('keep');
  });

  it('prefixes what it writes', async () => {
    const s = createTableUrlState({ keys: ['search', 'page'], prefix: 'a' });
    s.search = 'ana';
    s.page = 2;
    s.sync();

    const p = await written();
    expect(p.get('aq')).toBe('ana');
    expect(p.get('apage')).toBe('2');
    expect(p.has('q')).toBe(false);
  });

  it('coalesces repeated syncs in one microtask into the last write', async () => {
    const s = createTableUrlState({ keys: ['search'] });
    s.search = 'a';
    s.sync();
    s.search = 'ab';
    s.sync();
    s.search = 'abc';
    s.sync();

    const p = await written();
    expect(p.get('q')).toBe('abc');
  });

  it('skips a write that would not change the URL', async () => {
    at('?q=ana');
    const s = createTableUrlState({ keys: ['search'] });
    s.sync();
    await flush();
    expect(mocks.replaceState).not.toHaveBeenCalled();
  });

  it('navigates with goto when replace is false', async () => {
    const s = createTableUrlState({ keys: ['search'], replace: false });
    s.search = 'ana';
    s.sync();
    await flush();
    expect(mocks.replaceState).not.toHaveBeenCalled();
    expect(mocks.goto).toHaveBeenCalledTimes(1);
    expect(mocks.goto.mock.calls[0][0]).toBe('/t?q=ana');
  });
});

describe('createTableUrlState — clear', () => {
  it('resets owned fields and drops their params, keeping the rest', async () => {
    at('?tab=open&q=ana&sort=name:asc&f.stage=new&page=3&x=a');
    const s = createTableUrlState({ keys: [...ALL] });
    s.clear();

    expect(s.search).toBe('');
    expect(s.sort).toEqual([]);
    expect(s.filters).toEqual({});
    expect(s.page).toBe(1);
    expect(s.expanded).toEqual([]);

    const p = await written();
    expect([...p.keys()]).toEqual(['tab']);
  });

  it('leaves fields it does not own alone', async () => {
    at('?q=ana&page=3');
    const s = createTableUrlState({ keys: ['search'] });
    s.page = 5;
    s.clear();
    expect(s.page).toBe(5);

    const p = await written();
    expect(p.has('q')).toBe(false);
    expect(p.get('page')).toBe('3');
  });
});
