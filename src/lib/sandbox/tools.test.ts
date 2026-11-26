// @vitest-environment happy-dom
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerSandboxTools, SANDBOX_CHANGED_EVENT } from './tools';
import { executeTool, getTools } from '$lib/assistant/model-context';

const TOOL_NAMES = [
  'sandbox.arrange',
  'sandbox.block_chart',
  'sandbox.block_filter',
  'sandbox.block_kpi',
  'sandbox.block_list',
  'sandbox.block_table',
  'sandbox.blocks',
  'sandbox.datasets',
  'sandbox.list_elements',
  'sandbox.preview',
  'sandbox.remove_element',
  'sandbox.upsert_element',
  'sandbox.wire',
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
  test('registers the page-scoped tools and the abort signal removes them', () => {
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

  test('upsert_element teaches the three lazy libraries and when to prefer which', () => {
    registerSandboxTools({ signal: controller.signal });
    const upsert = getTools().find((t) => t.name === 'sandbox.upsert_element')!;
    const js = (upsert.inputSchema.properties as Record<string, { description: string }>).js
      .description;
    expect(js).toContain('await minion.echarts (default for charts)');
    expect(js).toContain('await minion.d3');
    expect(js).toContain('await minion.echartsGl (3D');
    expect(upsert.description).toContain('minion.echartsGl for 3D');
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

describe('block tools (spec 049)', () => {
  test('block_kpi validates, POSTs {title, w, spec} with v/type added and announces the change', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ element: { id: 'el-k' } }));
    const seen: string[] = [];
    const onChange = (e: Event) => seen.push((e as CustomEvent).detail.id);
    window.addEventListener(SANDBOX_CHANGED_EVENT, onChange);
    registerSandboxTools({ signal: controller.signal });
    const out = JSON.parse(
      await executeTool('sandbox.block_kpi', {
        title: 'Sales',
        w: 1,
        source: {
          dataset: 'pos.tickets',
          metric: { fn: 'sum', col: 'total' },
          period: { col: 'submitted_at', range: 'this_month' },
        },
        format: 'money',
        compare: true,
      }),
    );
    window.removeEventListener(SANDBOX_CHANGED_EVENT, onChange);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/sandbox/elements');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ title: 'Sales', w: 1 });
    expect(body.spec).toMatchObject({
      v: 1,
      type: 'kpi',
      format: 'money',
      tone: 'accent',
      compare: true,
    });
    expect(body).not.toHaveProperty('html');
    expect(out.id).toBe('el-k');
    expect(seen).toEqual(['el-k']);
  });

  test('an invalid block input is refused with the field path and nothing is written', async () => {
    registerSandboxTools({ signal: controller.signal });
    const out = JSON.parse(
      await executeTool('sandbox.block_chart', {
        title: 'Bad',
        preset: 'radar',
        source: {
          dataset: 'pos.tickets',
          dimension: 'status',
          measures: [{ fn: 'count', col: '*' }],
        },
      }),
    );
    expect(out.error).toMatch(/^invalid preset/);
    expect(fetchMock).not.toHaveBeenCalled();
    const patch = JSON.parse(
      await executeTool('sandbox.block_list', {
        id: 'el-3',
        title: 'Top',
        source: {
          dataset: 'pos.ticket_lines',
          dimension: 'product_name',
          metric: { fn: 'sum', col: 'total' },
        },
      }),
    );
    expect(fetchMock.mock.calls[0][0]).toBe('/api/sandbox/elements/el-3');
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
    expect(patch.id).toBe('el-3');
  });

  test('the catalogue lists kinds, presets and one example per kind; schemas enumerate presets', async () => {
    registerSandboxTools({ signal: controller.signal });
    const out = JSON.parse(await executeTool('sandbox.blocks', {}));
    expect(out.kinds).toEqual(['kpi', 'chart', 'table', 'list']);
    expect(out.presets.chart).toContain('donut');
    expect(out.presets.period).toContain('last_30d');
    expect(Object.keys(out.examples)).toEqual(['kpi', 'chart', 'table', 'list']);
    const chart = getTools().find((t) => t.name === 'sandbox.block_chart')!;
    expect(chart.inputSchema.required).toEqual(expect.arrayContaining(['title', 'source']));
    expect(JSON.stringify(chart.inputSchema)).toContain('"horizontal-bar"');
    expect(fetchMock).not.toHaveBeenCalled();
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
      { id: 'e1', title: 'T', w: 2, h: 1, datasets: [], chart: null, listens: [], problems: [] },
    ]);
  });
});

describe('synced pages (spec 150)', () => {
  const save = () => fetchMock.mockResolvedValue(jsonResponse({ element: { id: 'f1' } }));

  test('sandbox.block_filter writes a filter spec without a grid size', async () => {
    save();
    registerSandboxTools({ signal: controller.signal });
    const out = JSON.parse(
      await executeTool('sandbox.block_filter', {
        title: 'Period',
        var: 'period',
        control: 'date_range',
        default: { kind: 'date', range: 'last_30d' },
      }),
    );
    expect(out.id).toBe('f1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/sandbox/elements');
    expect(JSON.parse(init.body)).toEqual({
      title: 'Period',
      spec: {
        v: 1,
        type: 'filter',
        var: 'period',
        control: 'date_range',
        default: { kind: 'date', range: 'last_30d' },
      },
    });
  });

  test('a bad filter returns the grammar error instead of calling the API', async () => {
    registerSandboxTools({ signal: controller.signal });
    const out = JSON.parse(
      await executeTool('sandbox.block_filter', { title: 'x', var: 'Bad', control: 'date_range' }),
    );
    expect(out.error).toContain('invalid var');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a block tool accepts listens and an update without listens sends none (server keeps them)', async () => {
    save();
    registerSandboxTools({ signal: controller.signal });
    const listens = [{ var: 'period', col: 'submitted_at' }];
    const kpi = {
      title: 'Sales',
      source: { dataset: 'pos.tickets', metric: { fn: 'sum', col: 'total' } },
    };
    await executeTool('sandbox.block_kpi', { ...kpi, listens });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).spec.listens).toEqual(listens);
    await executeTool('sandbox.block_kpi', { ...kpi, id: 'k1', tone: 'info' });
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('/api/sandbox/elements/k1');
    expect(JSON.parse(init.body).spec).not.toHaveProperty('listens');
  });

  test('sandbox.wire PATCHes only the connections', async () => {
    save();
    registerSandboxTools({ signal: controller.signal });
    const listens = [{ var: 'period', col: 'submitted_at' }];
    await executeTool('sandbox.wire', { id: 'k1', listens });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/sandbox/elements/k1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ listens });
    const bad = JSON.parse(
      await executeTool('sandbox.wire', { id: 'k1', listens: [{ var: 'Bad', col: 'x' }] }),
    );
    expect(bad.error).toContain('invalid listens');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('list_elements returns the wiring report next to the elements', async () => {
    registerSandboxTools({ signal: controller.signal });
    const wiring = {
      publishers: [],
      duplicates: [],
      blocks: {
        k1: {
          bindings: [],
          problems: [{ var: 'gone', code: 'no_publisher', detail: 'no filter publishes "gone"' }],
        },
      },
    };
    const spec = {
      v: 1,
      type: 'kpi',
      source: { dataset: 'pos.tickets', metric: { fn: 'count', col: '*' } },
      listens: [{ var: 'gone', col: 'status' }],
    };
    fetchMock.mockResolvedValue(
      jsonResponse({ elements: [{ id: 'k1', title: 'K', w: 1, h: 1, spec }], wiring }),
    );
    const out = JSON.parse(await executeTool('sandbox.list_elements', {}));
    expect(out.wiring).toEqual(wiring);
    expect(out.elements[0]).toMatchObject({
      id: 'k1',
      listens: [{ var: 'gone', col: 'status' }],
      problems: wiring.blocks.k1.problems,
    });
  });

  test('arrange reports filter ids in failed and never PATCHes them', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ element: { id: 'x' } }));
    registerSandboxTools({ signal: controller.signal, isFilter: (id) => id === 'f1' });
    const out = JSON.parse(await executeTool('sandbox.arrange', { order: ['f1', 'a'] }));
    expect(out).toEqual({ updated: 1, failed: ['f1'] });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/sandbox/elements/a']);
  });
});

test('serial arrange retains a received commit when live validity ends and never starts a second write or refresh', async () => {
  const { bindEffectLease } = await import('$lib/assistant/effect-lease');
  let current = true;
  const lease = bindEffectLease({ signal: new AbortController().signal }, () => current);
  let release!: (response: Response) => void;
  fetchMock.mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  const acknowledge = vi.fn(async () => true);
  registerSandboxTools({ signal: controller.signal, acknowledge });
  const pending = executeTool(
    'sandbox.arrange',
    { order: ['a', 'b'] },
    { signal: lease.signal, lease },
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
  current = false;
  release(jsonResponse({ id: 'a' }));
  expect(JSON.parse(await pending)).toEqual({
    updated: 1,
    failed: ['b'],
    committed: true,
    refreshFailed: true,
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(acknowledge).not.toHaveBeenCalled();
});
