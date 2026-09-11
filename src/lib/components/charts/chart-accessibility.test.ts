// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import type { EChartsOption } from 'echarts';
import Chart from './Chart.svelte';

const engine = vi.hoisted(() => ({
  setOption: vi.fn(),
  on: vi.fn(),
  dispose: vi.fn(),
  resize: vi.fn(),
  dispatchAction: vi.fn(),
  getOption: vi.fn(() => ({})),
}));
vi.mock('echarts', () => ({ registerTheme: vi.fn(), init: vi.fn(() => engine) }));
let reduced = false;
let listener: (() => void) | undefined;
const remove = vi.fn();
const cancelFrame = vi.fn();
const disconnect = vi.fn();
let resizeCallbacks: (() => void)[] = [];
const line: EChartsOption = {
  xAxis: { type: 'category', data: ['Aug 1', 'Aug 2'] },
  yAxis: { type: 'value' },
  series: [{ name: 'Sentiment', type: 'line', data: [0.5, -0.25] }],
};

beforeEach(() => {
  vi.clearAllMocks();
  reduced = false;
  resizeCallbacks = [];
  listener = undefined;
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return reduced;
    },
    addEventListener: (_: string, cb: () => void) => {
      listener = cb;
    },
    removeEventListener: remove,
  }));
  vi.stubGlobal('requestAnimationFrame', () => 42);
  vi.stubGlobal('cancelAnimationFrame', cancelFrame);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resizeCallbacks.push(callback);
      }
      observe() {}
      disconnect = disconnect;
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
async function ready() {
  await vi.waitFor(() => expect(engine.setOption).toHaveBeenCalled());
}
function html(options: EChartsOption = line) {
  return render(Chart, { options, ariaLabel: 'Sentiment trend', tableCategoryLabel: 'Date' });
}

describe('real mounted Chart data and semantics', () => {
  it('names the image and keeps the accessible table outside its atomic image subtree', () => {
    const { container } = html();
    const image = container.querySelector('[role="img"]');
    expect(image?.getAttribute('aria-label')).toBe('Sentiment trend');
    expect(image?.querySelector('table')).toBeNull();
    expect(container.querySelector('table caption')?.textContent).toBe('Sentiment trend');
    expect(container.querySelector('summary')?.textContent).toBe('View chart data as table');
    expect(container.querySelectorAll('th[scope="row"]')).toHaveLength(2);
    expect(container.querySelector('td')?.textContent).toBe('0.5');
  });
  it('uses translated defaults and numbered unnamed series', () => {
    const { container } = render(Chart, {
      options: { ...line, series: [{ type: 'line', data: [1] }] },
    });
    expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Chart');
    expect(container.textContent).toContain('Series 1');
  });
  it('uses category object values and string formatters plus the correct value-axis formatter', () => {
    const { container } = html({
      xAxis: { type: 'category', data: [{ value: 'A' }], axisLabel: { formatter: 'Day {value}' } },
      yAxis: [
        { type: 'value' },
        { type: 'value', axisLabel: { formatter: (v: number) => `USD ${v.toFixed(2)}` } },
      ],
      series: { type: 'bar', yAxisIndex: 1, data: [{ value: 2.5 }] },
    });
    expect(container.querySelector('tbody th')?.textContent).toBe('Day A');
    expect(container.querySelector('td')?.textContent).toBe('USD 2.50');
  });
  it('formats function categories, horizontal values and missing points without inventing zero', () => {
    const { container } = html({
      yAxis: {
        type: 'category',
        data: ['a', 'b'],
        axisLabel: { formatter: (v: string) => v.toUpperCase() },
      },
      xAxis: { type: 'value', axisLabel: { formatter: '{value} ms' } },
      series: [{ type: 'bar', data: [4, null] }],
    });
    expect(container.querySelector('tbody th')?.textContent).toBe('A');
    expect([...container.querySelectorAll('td')].map((x) => x.textContent)).toEqual(['4 ms', '—']);
  });
  it('does not falsely join series on different category axes', () => {
    const { container } = html({
      xAxis: [
        { type: 'category', data: ['A'] },
        { type: 'category', data: ['B'] },
      ],
      series: [
        { type: 'line', data: [1] },
        { type: 'line', xAxisIndex: 1, data: [2] },
      ],
    });
    expect(container.querySelector('table')).toBeNull();
  });
  it.each([
    { series: [{ type: 'pie', data: [{ value: 2, name: 'a' }] }] },
    { ...line, series: [{ type: 'scatter', data: [[1, 2]] }] },
    { ...line, series: [{ type: 'line', data: [[0, 2]] }] },
    {},
  ] as EChartsOption[])(
    'omits unsupported or empty data instead of fabricating an alternative',
    (options) => {
      expect(html(options).container.querySelector('table')).toBeNull();
    },
  );
  it('escapes injected labels and formatter output', () => {
    const { container } = html({
      ...line,
      xAxis: { type: 'category', data: ['<img src=x>'] },
      series: [{ type: 'line', name: '<b>x</b>', data: [3] }],
      yAxis: { axisLabel: { formatter: () => '<script>bad</script>' } },
    });
    expect(container.querySelector('img, script, b')).toBeNull();
    expect(container.textContent).toContain('<script>bad</script>');
  });
  it('updates table values and names when actual props change', async () => {
    const view = html();
    await view.rerender({
      options: { ...line, series: [{ name: 'Updated', type: 'line', data: [9, 8] }] },
      ariaLabel: 'Updated trend',
    });
    expect(view.container.querySelector('td')?.textContent).toBe('9');
    expect(view.container.querySelector('caption')?.textContent).toBe('Updated trend');
  });
});

describe('motion and lifecycle', () => {
  it('overrides series and marker motion without mutating caller data, then restores normal policy live', async () => {
    reduced = true;
    const options: EChartsOption = {
      ...line,
      animation: true,
      series: [
        {
          type: 'line',
          animation: true,
          markLine: { animation: true, data: [{ yAxis: 0 }] },
          data: [1, 2],
        },
      ],
    };
    const before = JSON.stringify(options);
    html(options);
    await ready();
    let applied = engine.setOption.mock.lastCall?.[0];
    expect(applied.animation).toBe(false);
    expect(applied.series[0].animation).toBe(false);
    expect(applied.series[0].markLine.animation).toBe(false);
    expect(JSON.stringify(options)).toBe(before);
    reduced = false;
    listener?.();
    await vi.waitFor(() => expect(engine.setOption.mock.lastCall?.[0].animation).toBe(true));
    applied = engine.setOption.mock.lastCall?.[0];
    expect(applied.series[0].animation).toBe(true);
  });
  it('turns reduced motion on live and retains it across theme reinitialization', async () => {
    html();
    await ready();
    reduced = true;
    listener?.();
    await vi.waitFor(() => expect(engine.setOption.mock.lastCall?.[0].animation).toBe(false));
    const count = engine.setOption.mock.calls.length;
    document.documentElement.setAttribute('data-theme', 'chart-test-theme');
    await vi.waitFor(() => expect(engine.setOption.mock.calls.length).toBeGreaterThan(count));
    expect(engine.setOption.mock.lastCall?.[0].animation).toBe(false);
    document.documentElement.removeAttribute('data-theme');
  });
  it('does not initialize a chart after synchronous unmount while its module is pending', async () => {
    html();
    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(engine.setOption).not.toHaveBeenCalled();
  });

  it('respects explicit disabled animation without reduced motion and preserves callbacks', async () => {
    const onItemClick = vi.fn();
    const onLegendToggle = vi.fn();
    render(Chart, { options: { ...line, animation: false }, onItemClick, onLegendToggle });
    await ready();
    expect(engine.setOption.mock.lastCall?.[0].animation).toBe(false);
    const click = engine.on.mock.calls.find(([name]) => name === 'click')![1] as (
      p: unknown,
    ) => void;
    const legend = engine.on.mock.calls.find(([name]) => name === 'legendselectchanged')![1] as (
      p: unknown,
    ) => void;
    click({ name: 'A' });
    legend({ name: 'A', selected: { A: false } });
    expect(onItemClick).toHaveBeenCalledWith({ name: 'A' });
    expect(onLegendToggle).toHaveBeenCalledWith({ name: 'A', selected: { A: false } });
  });
  it('removes motion/resize listeners, pending frame and chart on unmount', async () => {
    html();
    await ready();
    cleanup();
    expect(remove).toHaveBeenCalledWith('change', expect.any(Function));
    expect(disconnect).toHaveBeenCalled();
    expect(cancelFrame).toHaveBeenCalledWith(42);
    expect(engine.dispatchAction).toHaveBeenCalledWith({ type: 'hideTip' });
    expect(engine.dispose).toHaveBeenCalledTimes(1);
  });
});

describe('merge motion, exact table scope and current callbacks', () => {
  it.each([{ xAxisId: 'b' }, { yAxisId: 'b' }, { coordinateSystem: 'polar' }])(
    'refuses unhandled axis/coordinate association %j',
    (association) => {
      const { container } = html({
        xAxis: [
          { id: 'a', type: 'category', data: ['Wrong'] },
          { id: 'b', type: 'category', data: ['Right'] },
        ],
        yAxis: [
          { id: 'a', type: 'value' },
          { id: 'b', type: 'value' },
        ],
        series: [{ type: 'bar', data: [7], ...association }],
      } as EChartsOption);
      expect(container.querySelector('table')).toBeNull();
    },
  );

  it.each([true, false])(
    'restores native defaults and explicit marker/series motion with global animation=%s, preserving merge legend selection',
    async (animation) => {
      const native = await vi.importActual<typeof import('echarts')>('echarts');
      // Native SVG SSR model; deterministic text measurement replaces only the absent canvas device.
      native.setPlatformAPI({ measureText: (text) => ({ width: text.length * 8 }) });
      const actual = native.init(null, undefined, {
        renderer: 'svg',
        ssr: true,
        width: 320,
        height: 200,
      });
      engine.setOption.mockImplementation((options, flags) => actual.setOption(options, flags));
      engine.getOption.mockImplementation(() => actual.getOption());
      const current = () =>
        actual.getOption() as {
          animation: boolean;
          series: {
            animation: boolean;
            markLine: { animation: boolean };
            markPoint: { animation: boolean };
            markArea: { animation: boolean };
          }[];
          legend: { selected: Record<string, boolean> }[];
        };
      try {
        reduced = true;
        const view = render(Chart, {
          notMergeUpdate: false,
          options: {
            ...line,
            animation,
            legend: { selected: { Disabled: false } },
            series: [
              {
                id: 'default',
                name: 'Default',
                type: 'line',
                data: [1, 2],
                markLine: { data: [{ yAxis: 0 }] },
                markPoint: { data: [{ type: 'max', name: 'Maximum' }] },
                markArea: { data: [[{ xAxis: 'Aug 1' }, { xAxis: 'Aug 2' }]] },
              },
              {
                id: 'disabled',
                name: 'Disabled',
                type: 'line',
                data: [2, 3],
                animation: false,
                markLine: { animation: false, data: [{ yAxis: 1 }] },
                markPoint: { animation: false, data: [{ type: 'max', name: 'Maximum' }] },
                markArea: { animation: true, data: [[{ xAxis: 'Aug 1' }, { xAxis: 'Aug 2' }]] },
              },
            ],
          },
        });
        await ready();
        expect(current().series[0].animation).toBe(false);
        actual.dispatchAction({ type: 'legendUnSelect', name: 'Default' });
        reduced = false;
        listener?.();
        await vi.waitFor(() => expect(current().series[0].animation).toBeUndefined());
        expect(current().animation).toBe(animation);
        expect(current().series[0].animation).toBeUndefined();
        expect(current().series[0].markLine.animation).toBeUndefined();
        // Inspect the real series' inherited effective state, not just incoming keys.
        const model = (
          actual as unknown as {
            getModel(): { getSeriesByIndex(index: number): { isAnimationEnabled(): boolean } };
          }
        ).getModel();
        expect(model.getSeriesByIndex(0).isAnimationEnabled()).toBe(animation);
        expect(model.getSeriesByIndex(1).isAnimationEnabled()).toBe(false);
        expect(current().series[1].animation).toBe(false);
        expect(current().series[1].markLine.animation).toBe(false);
        expect(current().series[0].markPoint.animation).toBeUndefined();
        expect(current().series[0].markArea.animation).toBeUndefined();
        expect(current().series[1].markPoint.animation).toBe(false);
        expect(current().series[1].markArea.animation).toBe(true);
        expect(current().legend[0].selected.Default).toBe(false);
        expect(current().legend[0].selected.Disabled).toBe(false);
        view.unmount();
      } finally {
        actual.dispose();
        engine.setOption.mockImplementation(() => {});
        engine.getOption.mockImplementation(() => ({}));
      }
    },
  );

  it('dispatches to current callbacks and stops dispatching when props remove them', async () => {
    const first = vi.fn();
    const next = vi.fn();
    const legend = vi.fn();
    const nextLegend = vi.fn();
    const view = render(Chart, { options: line, onItemClick: first, onLegendToggle: legend });
    await ready();
    const click = engine.on.mock.calls.find(([name]) => name === 'click')![1] as (
      p: unknown,
    ) => void;
    const toggle = engine.on.mock.calls.find(([name]) => name === 'legendselectchanged')![1] as (
      p: unknown,
    ) => void;
    const point = { name: 'A' };
    const selection = { name: 'Default', selected: { Default: false } };
    click(point);
    toggle(selection);
    expect(first).toHaveBeenCalledWith(point);
    expect(legend).toHaveBeenCalledWith(selection);
    await view.rerender({ options: line, onItemClick: next, onLegendToggle: nextLegend });
    click(point);
    toggle(selection);
    expect(next).toHaveBeenCalledWith(point);
    expect(nextLegend).toHaveBeenCalledWith(selection);
    expect(first).toHaveBeenCalledTimes(1);
    await view.rerender({ options: line, onItemClick: undefined, onLegendToggle: undefined });
    click(point);
    toggle(selection);
    expect(next).toHaveBeenCalledTimes(1);
    expect(nextLegend).toHaveBeenCalledTimes(1);
  });
});

it('makes only an overflowing table viewport a named keyboard stop', async () => {
  const { container } = html();
  const viewport = container.querySelector('.chart-alt-viewport') as HTMLDivElement;
  expect(viewport).not.toBeNull();
  expect(viewport.hasAttribute('tabindex')).toBe(false);
  Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 320 });
  Object.defineProperty(viewport, 'scrollWidth', { configurable: true, value: 700 });
  resizeCallbacks.forEach((callback) => callback());
  await vi.waitFor(() => expect(viewport.tabIndex).toBe(0));
  expect(viewport.getAttribute('role')).toBe('region');
  expect(viewport.getAttribute('aria-label')).toContain('Sentiment trend');
  Object.defineProperty(viewport, 'scrollWidth', { configurable: true, value: 320 });
  resizeCallbacks.forEach((callback) => callback());
  await vi.waitFor(() => expect(viewport.hasAttribute('tabindex')).toBe(false));
  expect(viewport.hasAttribute('role')).toBe(false);
});
