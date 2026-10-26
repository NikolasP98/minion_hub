import { describe, expect, it } from 'vitest';
import { attributionSchema, parseAttribution } from './attribution';

const DOOR = 'door:11111111-2222-4333-8444-555555555555' as const;
const NOW = new Date('2026-10-25T10:00:00Z');

describe('parseAttribution', () => {
  it('keeps only the three UTM keys, trimmed and truncated to 100', () => {
    const url = new URL(
      `https://hub.test/es/d/x?utm_source=%20instagram%20&utm_medium=bio&utm_campaign=${'c'.repeat(150)}&utm_term=nope&gclid=1`,
    );
    const a = parseAttribution(url, null, 'hub.test', DOOR, NOW);
    expect(a).toEqual({
      door: DOOR,
      at: NOW.toISOString(),
      utm_source: 'instagram',
      utm_medium: 'bio',
      utm_campaign: 'c'.repeat(100),
    });
  });

  it('takes the host only from the referer, and drops our own host', () => {
    const url = new URL('https://hub.test/d/x');
    expect(
      parseAttribution(url, 'https://l.instagram.com/path?u=secret', 'hub.test', DOOR, NOW)
        .referrer_host,
    ).toBe('l.instagram.com');
    expect(
      parseAttribution(url, 'https://hub.test/es/crm', 'hub.test', DOOR, NOW).referrer_host,
    ).toBe(undefined);
    expect(parseAttribution(url, 'not a url', 'hub.test', DOOR, NOW).referrer_host).toBe(undefined);
  });

  it('round-trips through the strict schema', () => {
    const a = parseAttribution(
      new URL('https://hub.test/d/x?utm_source=ig'),
      'https://google.com/',
      'hub.test',
      DOOR,
      NOW,
    );
    expect(attributionSchema.parse(a)).toEqual(a);
  });
});

describe('attributionSchema', () => {
  it('rejects unknown keys, bad door keys and oversized values', () => {
    const base = { door: DOOR, at: NOW.toISOString() };
    expect(attributionSchema.safeParse({ ...base, ip: '1.2.3.4' }).success).toBe(false);
    expect(attributionSchema.safeParse({ ...base, door: 'evil:1' }).success).toBe(false);
    expect(attributionSchema.safeParse({ ...base, utm_source: 'x'.repeat(101) }).success).toBe(
      false,
    );
    expect(attributionSchema.safeParse(base).success).toBe(true);
  });
});
