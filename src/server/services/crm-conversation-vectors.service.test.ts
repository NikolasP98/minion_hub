import { describe, it, expect } from 'vitest';
import { chunkConversation } from './crm-conversation-vectors.service';

describe('chunkConversation', () => {
  it('role-tags by direction: inbound → Customer, outbound → Agent', () => {
    const chunks = chunkConversation([
      { direction: 'inbound', content: 'Hola, cuánto cuesta?' },
      { direction: 'outbound', content: 'Buenas! El precio es 250 soles.' },
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe('Customer: Hola, cuánto cuesta?\nAgent: Buenas! El precio es 250 soles.');
  });

  it('never emits an empty or whitespace-only chunk', () => {
    expect(chunkConversation([])).toEqual([]);
    expect(chunkConversation([{ direction: 'inbound', content: null }])).toEqual([]);
    expect(chunkConversation([{ direction: 'inbound', content: '   ' }])).toEqual([]);
    expect(chunkConversation([{ direction: 'outbound', content: '' }])).toEqual([]);
  });

  it('drops empty/whitespace bodies but keeps the real ones', () => {
    const chunks = chunkConversation([
      { direction: 'inbound', content: '  ' },
      { direction: 'inbound', content: 'Hola' },
      { direction: 'outbound', content: null },
      { direction: 'outbound', content: 'Hola, en qué te ayudo?' },
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe('Customer: Hola\nAgent: Hola, en qué te ayudo?');
  });

  it('splits into multiple chunks once maxChars is exceeded, never truncating mid-conversation into an empty tail', () => {
    const longLine = 'x'.repeat(50);
    const rows = Array.from({ length: 10 }, (_, i) => ({
      direction: i % 2 === 0 ? 'inbound' : 'outbound',
      content: longLine,
    }));
    const chunks = chunkConversation(rows, /* maxChars */ 120);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.trim().length).toBeGreaterThan(0);
      expect(c.startsWith('Customer:') || c.startsWith('Agent:')).toBe(true);
    }
    // Every line survives somewhere across the chunks (nothing silently dropped).
    const rejoined = chunks.join('\n');
    for (const r of rows) {
      expect(rejoined).toContain(r.content);
    }
  });

  it('a single line longer than maxChars still becomes its own non-empty chunk (no infinite loop)', () => {
    const chunks = chunkConversation([{ direction: 'inbound', content: 'x'.repeat(500) }], 100);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].length).toBeGreaterThan(100);
  });
});
