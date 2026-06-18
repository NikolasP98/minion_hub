import { describe, it, expect } from 'vitest';
import { buildConversationText, isThin } from './crm-similarity';

describe('buildConversationText', () => {
  it('labels by direction, chronological, skips empties', () => {
    const t = buildConversationText([
      { direction: 'inbound', content: 'hola, cuanto cuesta?' },
      { direction: 'outbound', content: 'S/ 500' },
      { direction: 'inbound', content: '  ' },
    ]);
    expect(t).toBe('Cliente: hola, cuanto cuesta?\nNosotros: S/ 500');
  });
  it('truncates to maxChars', () => {
    const t = buildConversationText([{ direction: 'inbound', content: 'x'.repeat(50) }], { maxChars: 20 });
    expect(t.length).toBe(20);
  });
  it('returns empty string for no usable rows', () => {
    expect(buildConversationText([{ direction: 'inbound', content: null }])).toBe('');
  });
});

describe('isThin', () => {
  it('flags short average conversations', () => {
    expect(isThin(1.1)).toBe(true);
    expect(isThin(3.9)).toBe(true);
    expect(isThin(4)).toBe(false);
    expect(isThin(10)).toBe(false);
  });
});
