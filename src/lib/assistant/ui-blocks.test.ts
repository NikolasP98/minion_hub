import { describe, expect, it } from 'vitest';
import { parseUiBlocks, stripUiBlocks } from './ui-blocks';

describe('parseUiBlocks', () => {
  it('extracts one call and leaves the prose', () => {
    const text =
      'Opening stock entries.\n\n```minion-ui\n{"tool":"hub.navigate","input":{"path":"/stock/entries"}}\n```\n\nDone.';
    const r = parseUiBlocks(text);
    expect(r.calls).toEqual([{ tool: 'hub.navigate', input: { path: '/stock/entries' } }]);
    expect(r.text).toBe('Opening stock entries.\n\nDone.');
  });

  it('handles several fences, arrays, one-per-line, CRLF and missing input', () => {
    const text =
      'a\r\n```minion-ui\r\n[{"tool":"x"},{"tool":"y","input":{"k":1}}]\r\n```\r\nb\n```minion-ui\n{"tool":"p"}\n{"tool":"q"}\n```';
    const r = parseUiBlocks(text);
    expect(r.calls.map((c) => c.tool)).toEqual(['x', 'y', 'p', 'q']);
    expect(r.calls[1].input).toEqual({ k: 1 });
    expect(r.calls[0].input).toEqual({});
    expect(r.text.replace(/\s+/g, ' ')).toBe('a b');
  });

  it('hides an unterminated fence while streaming and ignores junk', () => {
    expect(stripUiBlocks('Sure.\n```minion-ui\n{"tool":"hub.nav')).toBe('Sure.');
    const r = parseUiBlocks('```minion-ui\nnot json at all\n```');
    expect(r.calls).toEqual([]);
    expect(r.text).toBe('');
  });

  it('never swallows prose after an empty or glued-close fence', () => {
    expect(parseUiBlocks('a\n\n```minion-ui\n```\n\nb')).toEqual({ calls: [], text: 'a\n\nb' });
    const r = parseUiBlocks('a\n```minion-ui\n{"tool":"x"}```\nb');
    expect(r.calls).toEqual([{ tool: 'x', input: {} }]);
    expect(r.text.replace(/\s+/g, ' ')).toBe('a b');
  });

  it('accepts the JSON on the opener line (DeepSeek in prod, 2026-09-02)', () => {
    const r = parseUiBlocks(
      'Vamos.\n\n```minion-ui {"tool":"hub.navigate","input":{"path":"/stock/items","params":{"new":"1"}}}\n```\n\nTe abrí el formulario.',
    );
    expect(r.calls).toEqual([
      { tool: 'hub.navigate', input: { path: '/stock/items', params: { new: '1' } } },
    ]);
    expect(r.text).toBe('Vamos.\n\nTe abrí el formulario.');
  });

  it('does not touch other code fences', () => {
    const text = '```json\n{"tool":"nope"}\n```';
    expect(parseUiBlocks(text)).toEqual({ calls: [], text });
  });
});
