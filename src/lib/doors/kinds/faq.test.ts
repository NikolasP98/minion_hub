import { describe, expect, it } from 'vitest';
import { configSchema, defaultConfig, faqJsonLd, kind } from './faq';
import { getDoorKind } from '../kinds';

const entry = (id: string, status: 'draft' | 'approved', a = 'Sí.') => ({
  id,
  q: `¿Pregunta ${id}?`,
  a,
  status,
});

describe('faq door config', () => {
  it('is registered and its default is valid', () => {
    expect(getDoorKind('faq')?.kind).toBe(kind);
    expect(configSchema.safeParse(defaultConfig).success).toBe(true);
  });

  it('accepts drafts without an answer but not approved entries', () => {
    expect(configSchema.safeParse({ entries: [entry('a', 'draft', '')] }).success).toBe(true);
    expect(configSchema.safeParse({ entries: [entry('a', 'approved', '  ')] }).success).toBe(false);
  });

  it('caps entries at 50, rejects duplicate ids, unknown keys and bad WhatsApp numbers', () => {
    const many = Array.from({ length: 51 }, (_, i) => entry(`e${i}`, 'draft'));
    expect(configSchema.safeParse({ entries: many }).success).toBe(false);
    expect(
      configSchema.safeParse({ entries: [entry('a', 'draft'), entry('a', 'draft')] }).success,
    ).toBe(false);
    expect(configSchema.safeParse({ entries: [], extra: 1 }).success).toBe(false);
    expect(configSchema.safeParse({ entries: [], whatsappNumber: 'call me' }).success).toBe(false);
    expect(configSchema.safeParse({ entries: [], whatsappNumber: '+51900000000' }).success).toBe(
      true,
    );
  });
});

describe('faqJsonLd', () => {
  it('is an FAQPage with exactly the given questions', () => {
    const ld = JSON.parse(
      faqJsonLd([
        { q: 'Q1', a: 'A1' },
        { q: 'Q2', a: 'A2' },
      ]),
    );
    expect(ld['@type']).toBe('FAQPage');
    expect(ld.mainEntity.map((e: { name: string }) => e.name)).toEqual(['Q1', 'Q2']);
    expect(ld.mainEntity[0].acceptedAnswer).toEqual({ '@type': 'Answer', text: 'A1' });
  });

  it('cannot be broken out of by </script> in an answer', () => {
    const evil = '</script><script>alert(1)</script>';
    const out = faqJsonLd([{ q: '<b>q</b>', a: evil }]);
    expect(out).not.toContain('<');
    expect(JSON.parse(out).mainEntity[0].acceptedAnswer.text).toBe(evil);
  });
});
