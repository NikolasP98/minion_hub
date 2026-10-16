// @vitest-environment happy-dom
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  addToPage,
  componentCopy,
  LIBRARY_CHANGED_EVENT,
  listLibrary,
  saveToLibrary,
  setPublished,
} from './library';

const element = {
  id: 'e1',
  page: 'default',
  title: 'KPI',
  html: '<b>1</b>',
  css: '',
  js: 'minion.ready(() => {})',
  w: 1,
  h: 1,
  position: 3,
  createdBy: 'u1',
  updatedAt: '2026-10-16T00:00:00Z',
  published: false,
  mine: true,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => jsonResponse({ element: { ...element, id: 'new' } }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('component library', () => {
  test('a copy carries only the code and size, never id/page/position/owner', () => {
    expect(componentCopy(element)).toEqual({
      title: 'KPI',
      html: '<b>1</b>',
      css: '',
      js: 'minion.ready(() => {})',
      w: 1,
      h: 1,
    });
  });

  test('saveToLibrary POSTs the copy to the library page and announces', async () => {
    const onChange = vi.fn();
    window.addEventListener(LIBRARY_CHANGED_EVENT, onChange);
    const saved = await saveToLibrary(element);
    window.removeEventListener(LIBRARY_CHANGED_EVENT, onChange);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/sandbox/elements');
    expect(JSON.parse(init.body)).toEqual({ ...componentCopy(element), page: 'library' });
    expect(saved.id).toBe('new');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('addToPage POSTs the copy to the board page', async () => {
    await addToPage(element);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      ...componentCopy(element),
      page: 'default',
    });
  });

  test('listLibrary reads the library page; setPublished PATCHes only that flag', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ elements: [element] }));
    expect(await listLibrary()).toEqual([element]);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/sandbox/elements?page=library');
    await setPublished('e1', true);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('/api/sandbox/elements/e1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ published: true });
  });
});
