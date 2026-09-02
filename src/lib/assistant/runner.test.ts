import { describe, expect, it } from 'vitest';
import { formatFollowUp, needsFollowUp } from './runner';

describe('needsFollowUp', () => {
  it('is false for clean navigation / fill / guide results', () => {
    expect(
      needsFollowUp([
        { tool: 'hub.navigate', result: JSON.stringify({ ok: true, path: '/stock', form: null }) },
        {
          tool: 'fill_stock_entry',
          result: JSON.stringify({ filled: ['qty'], rejected: [], missing: [] }),
        },
        { tool: 'ui.guide', result: JSON.stringify({ ok: true, steps: 3 }) },
      ]),
    ).toBe(false);
  });
  it('is true for errors, read tools, unmounted forms, missing/rejected fields', () => {
    expect(
      needsFollowUp([{ tool: 'hub.navigate', result: JSON.stringify({ error: 'no page' }) }]),
    ).toBe(true);
    expect(needsFollowUp([{ tool: 'hub.pages', result: JSON.stringify({ pages: [] }) }])).toBe(
      true,
    );
    expect(
      needsFollowUp([
        {
          tool: 'hub.navigate',
          result: JSON.stringify({ ok: true, path: '/x', form: { mounted: false } }),
        },
      ]),
    ).toBe(true);
    expect(
      needsFollowUp([
        { tool: 'fill_x', result: JSON.stringify({ filled: [], rejected: [], missing: ['qty'] }) },
      ]),
    ).toBe(true);
    expect(needsFollowUp([{ tool: 'fill_x', result: 'garbage' }])).toBe(true);
  });
  it('formats a follow-up the page-envelope stripper recognises', () => {
    const t = formatFollowUp([{ tool: 'hub.pages', result: '{"pages":[]}' }]);
    expect(t.startsWith('[In-app assistant context')).toBe(true);
    expect(t.endsWith("Don't restate this context.]")).toBe(true);
  });
});
