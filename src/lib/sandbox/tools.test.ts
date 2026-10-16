// @vitest-environment happy-dom
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerSandboxTools, SANDBOX_CHANGED_EVENT } from './tools';
import { executeTool, getTools } from '$lib/assistant/model-context';

const TOOL_NAMES = [
  'sandbox.arrange',
  'sandbox.datasets',
  'sandbox.list_elements',
  'sandbox.preview',
  'sandbox.remove_element',
  'sandbox.upsert_element',
];

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
let controller: AbortController;

beforeEach(() => {
  fetchMock = vi.fn(async () => jsonResponse({}));
  vi.stubGlobal('fetch', fetchMock);
  controller = new AbortController();
});

afterEach(() => {
  controller.abort();
  vi.unstubAllGlobals();
});

function names() {
  return getTools()
    .map((t) => t.name)
    .filter((n) => n.startsWith('sandbox.'));
}

describe('registerSandboxTools', () => {
  test('registers the five page-scoped tools and the abort signal removes them', () => {
    registerSandboxTools({ signal: controller.signal });
    expect(names()).toEqual(TOOL_NAMES);
    controller.abort();
    expect(names()).toEqual([]);
  });

  test('every tool carries an object input schema and a description the model can act on', () => {
    registerSandboxTools({ signal: controller.signal });
    for (const tool of getTools().filter((t) => t.name.startsWith('sandbox.'))) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.description.length).toBeGreaterThan(80);
    }
  });
});

describe('sandbox.arrange', () => {
  test('PATCHes a position per order entry and sizes per id, then announces the change', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ element: { id: 'x' } }));
    registerSandboxTools({ signal: controller.signal });
    const onChange = vi.fn();
    window.addEventListener(SANDBOX_CHANGED_EVENT, onChange);
    const out = JSON.parse(
      await executeTool('sandbox.arrange', { order: ['a', 'b'], sizes: [{ id: 'b', w: 4, h: 2 }] }),
    );
    window.removeEventListener(SANDBOX_CHANGED_EVENT, onChange);
    const calls = fetchMock.mock.calls.map(([url, init]) => [url, JSON.parse(init.body)]);
    expect(calls).toEqual([
      ['/api/sandbox/elements/a', { position: 0 }],
      ['/api/sandbox/elements/b', { position: 1, w: 4, h: 2 }],
    ]);
    expect(out).toEqual({ updated: 2, failed: [] });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('sandbox.preview', () => {
  test('clamps the limit to the sample size and returns shape + sample + count', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        dataset: 'pos.ticket_lines',
        columns: [{ name: 'total', type: 'number' }],
        rows: Array.from({ length: 20 }, (_, i) => ({ total: i })),
        limited: true,
      }),
    );
    registerSandboxTools({ signal: controller.signal });
    const out = JSON.parse(
      await executeTool('sandbox.preview', { spec: { dataset: 'pos.ticket_lines', limit: 1000 } }),
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/sandbox/query');
    expect(JSON.parse(init.body)).toEqual({ dataset: 'pos.ticket_lines', limit: 20 });
    expect(out.rowCount).toBe(20);
    expect(out.sample).toHaveLength(20);
    expect(out.columns).toEqual([{ name: 'total', type: 'number' }]);
  });

  test('a missing limit still asks for no more than the sample size', async () => {
    registerSandboxTools({ signal: controller.signal });
    await executeTool('sandbox.preview', { spec: { dataset: 'crm.contacts' } });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).limit).toBe(20);
  });

  test("a 403 surfaces the server's role message rather than a generic failure", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Your role does not permit 'view' on pos." }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    );
    registerSandboxTools({ signal: controller.signal });
    const out = JSON.parse(
      await executeTool('sandbox.preview', { spec: { dataset: 'pos.tickets' } }),
    );
    expect(out.error).toBe("Your role does not permit 'view' on pos.");
  });
});

describe('element write tools', () => {
  test('a create POSTs, returns the new id and announces the change to the page', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'el-1' }));
    const seen: string[] = [];
    const onChange = (e: Event) => seen.push((e as CustomEvent).detail.id);
    window.addEventListener(SANDBOX_CHANGED_EVENT, onChange);
    registerSandboxTools({ signal: controller.signal });

    const out = JSON.parse(
      await executeTool('sandbox.upsert_element', {
        title: 'Margin',
        html: '<div id="c"></div>',
        js: 'minion.ready(() => {})',
        w: 2,
      }),
    );
    window.removeEventListener(SANDBOX_CHANGED_EVENT, onChange);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/sandbox/elements');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ title: 'Margin', w: 2, css: '' });
    expect(out.id).toBe('el-1');
    expect(seen).toEqual(['el-1']);
  });

  test('an id turns the upsert into a PATCH on that element', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ element: { id: 'el-7' } }));
    registerSandboxTools({ signal: controller.signal });
    const out = JSON.parse(
      await executeTool('sandbox.upsert_element', {
        id: 'el-7',
        title: 'Margin',
        html: '<b></b>',
        js: '',
      }),
    );
    expect(fetchMock.mock.calls[0][0]).toBe('/api/sandbox/elements/el-7');
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
    expect(out.id).toBe('el-7');
  });

  test('a remove DELETEs and announces the change', async () => {
    const seen: string[] = [];
    const onChange = (e: Event) => seen.push((e as CustomEvent).detail.id);
    window.addEventListener(SANDBOX_CHANGED_EVENT, onChange);
    registerSandboxTools({ signal: controller.signal });
    await executeTool('sandbox.remove_element', { id: 'el-9' });
    window.removeEventListener(SANDBOX_CHANGED_EVENT, onChange);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/sandbox/elements/el-9');
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
    expect(seen).toEqual(['el-9']);
  });
});

describe('read tools tolerate either response envelope', () => {
  test('a bare array and a wrapped collection both list', async () => {
    registerSandboxTools({ signal: controller.signal });

    fetchMock.mockResolvedValue(jsonResponse([{ id: 'crm.contacts' }]));
    expect(JSON.parse(await executeTool('sandbox.datasets', {})).datasets).toEqual([
      { id: 'crm.contacts' },
    ]);

    fetchMock.mockResolvedValue(
      jsonResponse({ elements: [{ id: 'e1', title: 'T', w: 2, h: 1, html: 'dropped' }] }),
    );
    expect(JSON.parse(await executeTool('sandbox.list_elements', {})).elements).toEqual([
      { id: 'e1', title: 'T', w: 2, h: 1, datasets: [], chart: null },
    ]);
  });
});
