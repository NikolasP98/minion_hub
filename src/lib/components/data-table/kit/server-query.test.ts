import { describe, expect, it } from 'vitest';
import type { ServerQuery } from '../DataTable.svelte';
import { paramsToServerQuery, serverQueryToParams, type ServerQueryMap } from './server-query';

// `crm/customers`' own map: table sort keys → API sort names, `funnel` → `funnelStage`.
const MAP: ServerQueryMap = {
  sort: { score: 'score', recent: 'recent', name: 'name', msgs: 'frequency' },
  filters: { funnel: 'funnelStage' },
};

const query = (over: Partial<ServerQuery> = {}): ServerQuery => ({
  search: '',
  sort: null,
  filters: {},
  page: 1,
  pageSize: 0,
  ...over,
});

describe('serverQueryToParams', () => {
  it('encodes search, mapped sort + dir, filters, page and pageSize', () => {
    const p = serverQueryToParams(
      query({
        search: 'ana',
        sort: { key: 'msgs', dir: 'asc' },
        filters: { stage: 'new,won', funnel: 'lead' },
        page: 3,
        pageSize: 50,
      }),
      MAP,
    );
    expect(p.get('q')).toBe('ana');
    expect(p.get('sort')).toBe('frequency');
    expect(p.get('dir')).toBe('asc');
    expect(p.get('stage')).toBe('new,won');
    expect(p.get('funnelStage')).toBe('lead');
    expect(p.get('page')).toBe('3');
    expect(p.get('perPage')).toBe('50');
  });

  it('omits empty search, null sort, empty filters, page 1 and pageSize 0', () => {
    expect([...serverQueryToParams(query()).keys()]).toEqual([]);
    expect([...serverQueryToParams(query({ filters: { stage: '' } })).keys()]).toEqual([]);
  });

  it('passes unmapped keys through unchanged', () => {
    const p = serverQueryToParams(
      query({ sort: { key: 'custom:7', dir: 'desc' }, filters: { tier: 'a' } }),
    );
    expect(p.get('sort')).toBe('custom:7');
    expect(p.get('dir')).toBe('desc');
    expect(p.get('tier')).toBe('a');
  });
});

describe('paramsToServerQuery', () => {
  it('inverts the map and treats every unreserved param as a filter', () => {
    const q = paramsToServerQuery(
      new URLSearchParams(
        'q=ana&sort=frequency&dir=asc&stage=new,won&funnelStage=lead&page=3&perPage=50',
      ),
      MAP,
    );
    expect(q).toEqual({
      search: 'ana',
      sort: { key: 'msgs', dir: 'asc' },
      filters: { stage: 'new,won', funnel: 'lead' },
      page: 3,
      pageSize: 50,
    });
  });

  it('defaults a dir-less sort to desc, like the URL-seeded initial query', () => {
    expect(paramsToServerQuery(new URLSearchParams('sort=score')).sort).toEqual({
      key: 'score',
      dir: 'desc',
    });
  });

  it('returns the empty query for empty params', () => {
    expect(paramsToServerQuery(new URLSearchParams())).toEqual(query());
  });

  it('clamps a nonsense page and pageSize', () => {
    const q = paramsToServerQuery(new URLSearchParams('page=0&perPage=nope'));
    expect(q.page).toBe(1);
    expect(q.pageSize).toBe(0);
  });
});

describe('round trip', () => {
  it('survives both directions under the same map', () => {
    const q = query({
      search: 'ana',
      sort: { key: 'name', dir: 'desc' },
      filters: { stage: 'new', funnel: 'lead' },
      page: 2,
      pageSize: 25,
    });
    expect(paramsToServerQuery(serverQueryToParams(q, MAP), MAP)).toEqual(q);
  });
});
