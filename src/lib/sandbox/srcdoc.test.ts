import { describe, expect, it } from 'vitest';
import { buildSrcdoc } from './srcdoc';
import { vendorScriptTags } from './vendor';

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
  });
});
