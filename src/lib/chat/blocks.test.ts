import { describe, expect, it } from 'vitest';
import { activityVerb, foldToolTurns, normalizeBlocks, toolVerb } from './blocks';

const call = (id: string, ts: number) => ({
  role: 'assistant',
  timestamp: ts,
  content: [{ type: 'toolCall', id, name: 'find_related', arguments: '{}' }],
});
const result = (id: string) => ({
  role: 'toolResult',
  toolCallId: id,
  content: 'nope',
  isError: true,
});
const reply = (text: string, ts: number) => ({
  role: 'assistant',
  timestamp: ts,
  content: [{ type: 'text', text }],
});

describe('foldToolTurns', () => {
  it('folds a run of tool-only turns into the reply that follows', () => {
    const out = foldToolTurns([
      { role: 'user', content: 'go' },
      call('a', 1),
      result('a'),
      call('b', 2),
      result('b'),
      reply('done', 3),
    ]);
    expect(out.map((m) => (m as { role: string }).role)).toEqual([
      'user',
      'toolResult',
      'toolResult',
      'assistant',
    ]);
    const merged = out[3] as { timestamp: number; content: unknown };
    expect(merged.timestamp).toBe(3);
    expect(normalizeBlocks(merged.content).map((b) => b.kind)).toEqual(['tool', 'tool', 'text']);
  });

  it('flushes a trailing run as one synthetic turn stamped with the last call', () => {
    const out = foldToolTurns([call('a', 1), result('a'), call('b', 2)]);
    const last = out.at(-1) as { role: string; timestamp: number; content: unknown };
    expect(out).toHaveLength(2);
    expect(last.role).toBe('assistant');
    expect(last.timestamp).toBe(2);
    expect(normalizeBlocks(last.content)).toHaveLength(2);
  });

  it('never folds across a user message and leaves plain turns alone', () => {
    const input = [call('a', 1), { role: 'user', content: 'hi' }, reply('hey', 2)];
    const out = foldToolTurns(input);
    expect(out).toHaveLength(3);
    expect(out[1]).toBe(input[1]);
    expect(out[2]).toBe(input[2]);
  });
});

describe('toolVerb — Notion-style step verbs', () => {
  it('present while running, past once done, matched by substring', () => {
    expect(toolVerb('memory_search_facts', false)).toBe('Remembering');
    expect(toolVerb('memory_search_facts', true)).toBe('Remembered');
    expect(toolVerb('crm_query', true)).toBe('Queried data');
    expect(toolVerb('find_related', false)).toBe('Searching');
  });
  it('falls back to the tool id for unknown tools', () => {
    expect(toolVerb('zzz_custom', false)).toBe('Using zzz_custom');
    expect(toolVerb('zzz_custom', true)).toBe('Used zzz_custom');
    expect(activityVerb('read_file')).toBe('Reading…');
  });
});
