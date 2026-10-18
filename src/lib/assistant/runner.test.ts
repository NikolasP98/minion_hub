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
    expect(
      needsFollowUp([{ tool: 'hub.pages', result: JSON.stringify({ pages: [] }), readOnly: true }]),
    ).toBe(true);
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

describe('read-only page tools', () => {
  it('a tool declaring readOnlyHint sends its result back, with room for a full catalog', async () => {
    const { registerTool } = await import('./model-context');
    const { runUiCalls } = await import('./runner');
    const big = 'x'.repeat(6300);
    const offRead = registerTool({
      name: 'test.read',
      description: 'reads',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => ({ catalog: big }),
      annotations: { readOnlyHint: true },
    });
    const offWrite = registerTool({
      name: 'test.write',
      description: 'writes',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => ({ ok: true }),
      annotations: { readOnlyHint: false },
    });
    const read = await runUiCalls([{ tool: 'test.read', input: {} }]);
    const write = await runUiCalls([{ tool: 'test.write', input: {} }]);
    offRead();
    offWrite();
    expect(read[0].readOnly).toBe(true);
    expect(needsFollowUp(read)).toBe(true);
    expect(needsFollowUp(write)).toBe(false);
    expect(formatFollowUp(read)).toContain(big);
    expect(formatFollowUp([{ tool: 'test.write', result: big }])).not.toContain(big);
  });
});

describe('terminal navigation batches', () => {
  it('suppresses all other calls before and after navigation, including invalid destinations', async () => {
    const { registerTools } = await import('./model-context');
    const { runUiCalls } = await import('./runner');
    const { guide } = await import('./guide.svelte');
    const effects: string[] = [];
    const off = registerTools(
      ['hub.navigate', 'fill_test', 'ui.guide', 'test.read'].map((name) => ({
        name,
        description: '',
        inputSchema: {},
        annotations: { readOnlyHint: name === 'test.read' },
        execute: () => {
          effects.push(name);
          return { error: 'invalid path' };
        },
      })),
    );
    try {
      guide.lastActions = [];
      const outcomes = await runUiCalls(
        ['fill_test', 'test.read', 'hub.navigate', 'ui.guide', 'fill_test'].map((tool) => ({
          tool,
          input: {},
        })),
      );
      expect(effects).toEqual(['hub.navigate']);
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].requiresUserAction).toBe(true);
      expect(needsFollowUp(outcomes)).toBe(false);
      expect(
        needsFollowUp([{ tool: 'test.read', result: '{}', readOnly: true }, ...outcomes]),
      ).toBe(false);
      expect(guide.lastActions).toEqual([]);
    } finally {
      off();
    }
  });
});
