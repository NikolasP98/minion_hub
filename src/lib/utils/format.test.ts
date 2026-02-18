import { describe, it, expect } from 'vitest';
import { fmtTokens, fmtTimeAgo, fmtUptime, truncKey, escHtml } from './format';

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
