import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tagBulkState, tagBulkIntent, bulkLinkTags } from './tag-bulk';

describe('tagBulkState', () => {
  const rows = [['red', 'blue'], ['red'], ['blue']];

  it('is "all" when every row carries the tag', () => {
    expect(tagBulkState([['red'], ['red', 'blue']], 'red')).toBe('all');
  });
  it('is "some" when only part of the selection carries it', () => {
    expect(tagBulkState(rows, 'blue')).toBe('some');
  });
  it('is "none" when nobody carries it', () => {
    expect(tagBulkState(rows, 'green')).toBe('none');
  });
  it('is "none" for an empty selection', () => {
    expect(tagBulkState([], 'red')).toBe('none');
  });
});

describe('tagBulkIntent', () => {
  it('removes a tag that is fully applied, adds it otherwise', () => {
    expect(tagBulkIntent('all')).toBe('remove');
    expect(tagBulkIntent('some')).toBe('add');
    expect(tagBulkIntent('none')).toBe('add');
  });
});

describe('bulkLinkTags', () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true });
  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('no-ops with nothing to add/remove or nobody selected', async () => {
    await bulkLinkTags('stock', [], ['t1'], []);
    await bulkLinkTags('stock', ['i1'], [], []);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stock/catalog scopes POST one bulk request with the entity-kind targets', async () => {
    await bulkLinkTags('stock', ['i1', 'i2'], ['t1'], ['t2']);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/tags/bulk',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          scope: 'stock',
          add: ['t1'],
          remove: ['t2'],
          targets: [
            { type: 'item', id: 'i1' },
            { type: 'item', id: 'i2' },
          ],
        }),
      }),
    );

    fetchMock.mockClear();
    await bulkLinkTags('catalog', ['p1'], ['t1'], []);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/tags/bulk',
      expect.objectContaining({
        body: JSON.stringify({
          scope: 'catalog',
          add: ['t1'],
          remove: [],
          targets: [{ type: 'product', id: 'p1' }],
        }),
      }),
    );
  });

  it('crm scope fans out to the per-contact endpoint (no shared entity kind)', async () => {
    await bulkLinkTags('crm', ['c1', 'c2'], ['t1'], ['t2']);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/crm/contacts/c1/tags',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ tagId: 't1' }) }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/crm/contacts/c1/tags?tagId=t2',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
