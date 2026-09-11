// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import type { EChartsOption } from 'echarts';

// SSR shape used across this file's server-render assertions.
const lineOptions: EChartsOption = {
  xAxis: {
    type: 'category',
    data: ['2026-08-01', '2026-08-02'],
    axisLabel: {
      formatter: (v: string) =>
        new Date(`${v}T00:00:00Z`).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        }),
    },
  },
  yAxis: { type: 'value' },
  series: [{ name: 'Sentiment', type: 'line', data: [0.5, -0.25] }],
};

describe('Chart accessible name + nonvisual data table (SSR)', () => {
  it('renders role=img with a caller-supplied accessible name', async () => {
    const { default: Chart } = await import('./Chart.svelte');
    const html = render(Chart, {
      props: { options: lineOptions, ariaLabel: 'Monthly customer-sentiment trend' },
    }).body;
    expect(html).toMatch(/role="img"/);
    expect(html).toContain('aria-label="Monthly customer-sentiment trend"');
  });

  it('falls back to a generic translated name when no ariaLabel is passed', async () => {
    const { default: Chart } = await import('./Chart.svelte');
    const html = render(Chart, { props: { options: lineOptions } }).body;
    expect(html).toMatch(/aria-label="Chart"/);
  });

  it('derives a real text/table alternative from the actual series values, reusing the axis formatter', async () => {
    const { default: Chart } = await import('./Chart.svelte');
    const html = render(Chart, {
      props: { options: lineOptions, tableCategoryLabel: 'Date' },
    }).body;
    expect(html).toMatch(/<details\b/);
    // Native disclosure — keyboard-operable with no extra script.
    expect(html).toMatch(/<summary\b/);
    expect(html).toContain('<table');
    expect(html).toContain('>Date<');
    expect(html).toContain('>Sentiment<'); // series name used as column header
    // Category values render through the same formatter the visible axis uses,
    // not the raw ISO string.
    expect(html).toContain('>Aug 1<');
    expect(html).toContain('>Aug 2<');
    expect(html).toContain('>0.5<');
    expect(html).toContain('>-0.25<');
  });

  it('falls back to a numbered series label when the series has no name', async () => {
    const { default: Chart } = await import('./Chart.svelte');
    const unnamed: EChartsOption = {
      xAxis: { type: 'category', data: ['a', 'b'] },
      series: [{ type: 'line', data: [1, 2] }],
    };
    const html = render(Chart, { props: { options: unnamed } }).body;
    expect(html).toContain('>Series 1<');
  });

  it('escapes category and injected series values instead of treating them as HTML', async () => {
    const { default: Chart } = await import('./Chart.svelte');
    const unsafe: EChartsOption = {
      xAxis: { type: 'category', data: ['<img src=x onerror=alert(1)>'] },
      series: [{ name: '<b>bold</b>', type: 'line', data: [1] }],
    };
    const html = render(Chart, { props: { options: unsafe } }).body;
    expect(html).not.toContain('<img src=x');
    expect(html).not.toMatch(/<b>bold<\/b>/);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });

  it('omits the table entirely when the option does not fit the category/series shape (e.g. pie charts)', async () => {
    const { default: Chart } = await import('./Chart.svelte');
    const pie: EChartsOption = {
      series: [{ type: 'pie', data: [{ name: 'A', value: 1 }] }],
    };
    const html = render(Chart, { props: { options: pie } }).body;
    expect(html).not.toMatch(/<details\b/);
    // The name/description contract still holds even without a table alternative.
    expect(html).toMatch(/role="img"/);
  });

  it('omits the table when there is no data at all (rejects an empty/incomplete option)', async () => {
    const { default: Chart } = await import('./Chart.svelte');
    const empty: EChartsOption = {};
    const html = render(Chart, { props: { options: empty } }).body;
    expect(html).not.toMatch(/<details\b/);
  });
});

describe('Chart reduced-motion + callback contract (client mount)', () => {
  const setOptionCalls: EChartsOption[] = [];
  const onCalls: { event: string; handler: unknown }[] = [];
  let motionMatches = false;
  let motionChangeListener: ((ev: { matches: boolean }) => void) | undefined;

  beforeEach(() => {
    setOptionCalls.length = 0;
    onCalls.length = 0;
    motionMatches = false;
    motionChangeListener = undefined;

    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        get matches() {
          return query === '(prefers-reduced-motion: reduce)' ? motionMatches : false;
        },
        media: query,
        addEventListener: (_event: string, cb: (ev: { matches: boolean }) => void) => {
          motionChangeListener = cb;
        },
        removeEventListener: () => {
          motionChangeListener = undefined;
        },
      })),
    );

    vi.mock('echarts', () => ({
      registerTheme: vi.fn(),
      init: vi.fn(() => ({
        setOption: vi.fn((opts: EChartsOption) => setOptionCalls.push(opts)),
        resize: vi.fn(),
        dispose: vi.fn(),
        dispatchAction: vi.fn(),
        getOption: vi.fn(() => ({})),
        on: vi.fn((event: string, handler: unknown) => onCalls.push({ event, handler })),
      })),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.doUnmock('echarts');
  });

  it('disables animation on initial mount when prefers-reduced-motion is already set', async () => {
    motionMatches = true;
    const { render: mount, cleanup } = await import('@testing-library/svelte');
    const { default: Chart } = await import('./Chart.svelte');
    mount(Chart, { props: { options: lineOptions } });
    await vi.waitFor(() => expect(setOptionCalls.length).toBeGreaterThan(0));
    expect(setOptionCalls[0]?.animation).toBe(false);
    cleanup();
  });

  it('leaves the caller animation setting alone when reduced motion is not requested', async () => {
    motionMatches = false;
    const { render: mount, cleanup } = await import('@testing-library/svelte');
    const { default: Chart } = await import('./Chart.svelte');
    mount(Chart, { props: { options: lineOptions } });
    await vi.waitFor(() => expect(setOptionCalls.length).toBeGreaterThan(0));
    expect(setOptionCalls[0]?.animation).toBe(true);
    cleanup();
  });

  it('disables animation live when the OS preference changes after mount, without losing item/legend callbacks', async () => {
    motionMatches = false;
    const onItemClick = vi.fn();
    const onLegendToggle = vi.fn();
    const { render: mount, cleanup } = await import('@testing-library/svelte');
    const { default: Chart } = await import('./Chart.svelte');
    mount(Chart, { props: { options: lineOptions, onItemClick, onLegendToggle } });
    await vi.waitFor(() => expect(setOptionCalls.length).toBeGreaterThan(0));
    expect(setOptionCalls[0]?.animation).toBe(true);
    expect(onCalls.some((c) => c.event === 'click' && c.handler === onItemClick)).toBe(true);
    expect(
      onCalls.some((c) => c.event === 'legendselectchanged' && c.handler === onLegendToggle),
    ).toBe(true);

    motionMatches = true;
    motionChangeListener?.({ matches: true });
    await vi.waitFor(() =>
      expect(setOptionCalls[setOptionCalls.length - 1]?.animation).toBe(false),
    );
    cleanup();
  });
});
