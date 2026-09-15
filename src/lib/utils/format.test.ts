import { describe, it, expect, afterEach } from 'vitest';
import { fmtTokens, fmtTimeAgo, fmtUptime, truncKey, escHtml, formatMoney, formatDate } from './format';
import { setLanguageTag } from '$lib/paraglide/runtime';

describe('formatMoney', () => {
  const strip = (s: string) => s.replace(/ /g, ' '); // NBSP → space for stable asserts
  it('formats PEN by default with S/ symbol', () => expect(strip(formatMoney(1234.5))).toBe('S/ 1,234.50'));
  it('defaults currency to PEN when omitted', () => expect(formatMoney(50)).toContain('S/'));
  it('honors an explicit currency', () => expect(formatMoney(10, 'USD')).toMatch(/US\$|USD|\$/));
  it('accepts numeric strings (DB numeric)', () => expect(strip(formatMoney('800'))).toBe('S/ 800.00'));
  it('returns em-dash for null/NaN', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined)).toBe('—');
    expect(formatMoney('not a number')).toBe('—');
  });
  it('compact drops decimals', () => expect(formatMoney(1600, 'PEN', { compact: true })).not.toContain('.00'));
});

describe('fmtTokens', () => {
  it('returns "0" for null', () => expect(fmtTokens(null)).toBe('0'));
  it('returns "0" for undefined', () => expect(fmtTokens(undefined)).toBe('0'));
  it('returns "0" for 0', () => expect(fmtTokens(0)).toBe('0'));
  it('returns raw number for hundreds', () => expect(fmtTokens(450)).toBe('450'));
  it('formats thousands with k', () => expect(fmtTokens(2500)).toBe('2.5k'));
  it('formats even thousands', () => expect(fmtTokens(1000)).toBe('1.0k'));
  it('formats millions with M', () => expect(fmtTokens(3_200_000)).toBe('3.2M'));
  it('formats even millions', () => expect(fmtTokens(1_000_000)).toBe('1.0M'));
});

describe('fmtTimeAgo', () => {
  it('returns "-" for null', () => expect(fmtTimeAgo(null)).toBe('-'));
  it('returns "-" for undefined', () => expect(fmtTimeAgo(undefined)).toBe('-'));
  it('returns "-" for 0', () => expect(fmtTimeAgo(0)).toBe('-'));
  it('returns "just now" for future timestamps', () => {
    expect(fmtTimeAgo(Date.now() + 60_000)).toBe('just now');
  });
  it('formats seconds ago', () => {
    expect(fmtTimeAgo(Date.now() - 30_000)).toBe('30s ago');
  });
  it('formats minutes ago', () => {
    expect(fmtTimeAgo(Date.now() - 5 * 60_000)).toBe('5m ago');
  });
  it('formats hours ago', () => {
    expect(fmtTimeAgo(Date.now() - 3 * 3_600_000)).toBe('3h ago');
  });
  it('formats days ago', () => {
    expect(fmtTimeAgo(Date.now() - 2 * 86_400_000)).toBe('2d ago');
  });
});

describe('fmtUptime', () => {
  it('returns "-" for null', () => expect(fmtUptime(null)).toBe('-'));
  it('returns "-" for undefined', () => expect(fmtUptime(undefined)).toBe('-'));
  it('returns "-" for 0', () => expect(fmtUptime(0)).toBe('-'));
  it('returns "-" for negative', () => expect(fmtUptime(-1000)).toBe('-'));
  it('formats minutes only', () => expect(fmtUptime(5 * 60_000)).toBe('5m'));
  it('formats hours and minutes', () => {
    expect(fmtUptime(2 * 3_600_000 + 15 * 60_000)).toBe('2h 15m');
  });
  it('formats days, hours, and minutes', () => {
    expect(fmtUptime(86_400_000 + 3_600_000 + 30 * 60_000)).toBe('1d 1h 30m');
  });
});

describe('truncKey', () => {
  it('returns "" for null', () => expect(truncKey(null)).toBe(''));
  it('returns "" for undefined', () => expect(truncKey(undefined)).toBe(''));
  it('returns short string unchanged', () => expect(truncKey('abc')).toBe('abc'));
  it('truncates long string with ellipsis', () => {
    const long = 'a'.repeat(40);
    const result = truncKey(long);
    expect(result.length).toBe(29); // 28 + ellipsis char
    expect(result.endsWith('\u2026')).toBe(true);
  });
  it('respects custom max', () => {
    const result = truncKey('hello world', 5);
    expect(result).toBe('hello\u2026');
  });
});

describe('escHtml', () => {
  it('returns "" for null', () => expect(escHtml(null)).toBe(''));
  it('returns "" for undefined', () => expect(escHtml(undefined)).toBe(''));
  it('escapes < and >', () => {
    expect(escHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
    );
  });
  it('escapes &', () => expect(escHtml('a & b')).toBe('a &amp; b'));
  it('passes through safe text', () => expect(escHtml('hello')).toBe('hello'));
});

/** The bug this exists to stop: the scheduling calendar rendered "Mon Sep 7"
 *  inside a fully Spanish UI because it asked the BROWSER for the locale
 *  (`toLocaleDateString(undefined, …)`) instead of paraglide. */
describe('formatDate — follows the paraglide locale, not the browser', () => {
  const monday = '2026-09-07T00:00:00';
  afterEach(() => setLanguageTag(() => 'en'));

  it('renders English weekday/month for `en`', () => {
    setLanguageTag(() => 'en');
    expect(formatDate(monday, { weekday: 'short' })).toBe('Mon');
    expect(formatDate(monday, { day: 'numeric', month: 'short' })).toBe('Sep 7');
  });

  it('renders Spanish weekday/month for `es`', () => {
    setLanguageTag(() => 'es');
    expect(formatDate(monday, { weekday: 'short' }).toLowerCase()).toContain('lun');
    // Peru abbreviates septiembre as "set." — proof the locale really is es-PE,
    // the same one `formatMoney` uses, and not generic `es`.
    expect(formatDate(monday, { day: 'numeric', month: 'short' })).toBe('7 set.');
  });

  it('returns em-dash for null / unparseable input', () => {
    expect(formatDate(null, { weekday: 'short' })).toBe('—');
    expect(formatDate('not a date', { weekday: 'short' })).toBe('—');
  });
});
