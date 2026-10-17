import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { BRIDGE_SCRIPT } from './bridge';
import { buildSrcdoc } from './srcdoc';
import { VENDOR, vendorScriptTags } from './vendor';

const element = {
  id: 'el_1',
  title: 'Margin by product',
  html: '<div id="chart"></div>',
  css: '#chart{height:100%}',
  js: 'minion.ready(() => {});',
};

function build(overrides: Partial<Parameters<typeof buildSrcdoc>[0]> = {}) {
  return buildSrcdoc({
    element,
    origin: 'https://hub.minion-ai.org',
    themeVars: { '--color-accent': '#3b82f6' },
    vendorUrls: { echarts: '/assets/echarts.min.js' },
    ...overrides,
  });
}

describe('buildSrcdoc', () => {
  it('carries the CSP exactly as the contract states it', () => {
    expect(build()).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://hub.minion-ai.org; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'">`,
    );
  });

  it('never grants same-origin', () => {
    expect(build()).not.toContain('allow-same-origin');
  });

  it('renders the element html, css, theme tokens, bridge and user js', () => {
    const doc = build();
    expect(doc).toContain('<div id="chart"></div>');
    expect(doc).toContain('#chart{height:100%}');
    expect(doc).toContain('--color-accent:#3b82f6;');
    expect(doc).toContain('window.__MINION_SANDBOX__=');
    expect(doc).toContain('window.minion = minion;');
    expect(doc).toContain('minion.ready(() => {});');
  });

  it('neutralises a `</script>` smuggled through the config', () => {
    const doc = build({ element: { ...element, id: '</script><script>alert(1)' } });
    expect(doc).not.toContain('</script><script>alert(1)');
    expect(doc).toContain('\\u003c/script>');
  });
});

describe('vendorScriptTags', () => {
  it('emits one tag per allowlisted library', () => {
    expect(vendorScriptTags(['echarts'])).toMatch(/^<script src=".+"><\/script>$/);
    expect(vendorScriptTags(['echarts', 'echarts-gl', 'd3']).match(/<script /g)).toHaveLength(3);
  });

  it('allowlists exactly the libraries the bridge exposes', () => {
    expect(Object.keys(VENDOR).sort()).toEqual(['d3', 'echarts', 'echarts-gl']);
    expect(VENDOR.d3).toBe('/vendor/d3-slim.min.js');
    for (const lib of ['echarts', 'echartsGl', 'd3']) {
      expect(BRIDGE_SCRIPT).toContain(`Object.defineProperty(minion, '${lib}'`);
    }
  });

  // The slim bundle is a committed build output (`bun run vendor:d3`): prove
  // it is present and still defines the modules the model is told about.
  it('ships the prebuilt slim d3 with the promised modules', () => {
    const src = readFileSync(resolve(__dirname, '../../../static/vendor/d3-slim.min.js'), 'utf8');
    expect(src.length).toBeLessThan(250_000);
    const win: Record<string, unknown> = {};
    runInNewContext(src, { window: win, document: {}, self: win });
    const d3 = win.d3 as Record<string, unknown>;
    for (const fn of [
      'select',
      'scaleLinear',
      'scaleBand',
      'line',
      'arc',
      'axisBottom',
      'extent',
      'format',
      'timeFormat',
      'hierarchy',
      'treemap',
      'forceSimulation',
      'transition',
      'zoom',
      'drag',
      'interpolateBlues',
    ]) {
      expect(typeof d3[fn], fn).toBe('function');
    }
    expect(d3.geoPath).toBeUndefined();
  });
});
