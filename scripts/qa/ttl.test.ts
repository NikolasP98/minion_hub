import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TTL_SECONDS,
  MAX_TTL_SECONDS,
  MIN_TTL_SECONDS,
  clampTtl,
  formatDuration,
  parseListTimersJson,
  parseSystemdLeft,
  parseTtl,
} from './ttl';
import { disarmUnits } from './ttl';

describe('parseTtl', () => {
  it('parses minutes and hours', () => {
    expect(parseTtl('90m')).toBe(90 * 60);
    expect(parseTtl('2h')).toBe(2 * 3600);
    expect(parseTtl('45s')).toBe(60); // clamped up to the minimum, see below
  });

  it('defaults to 2h when omitted', () => {
    expect(parseTtl(undefined)).toBe(DEFAULT_TTL_SECONDS);
  });

  it('clamps above the 8h max', () => {
    expect(parseTtl('12h')).toBe(MAX_TTL_SECONDS);
  });

  it('clamps below the 1m min', () => {
    expect(parseTtl('10s')).toBe(MIN_TTL_SECONDS);
  });

  it('rejects malformed input', () => {
    expect(() => parseTtl('2 hours')).toThrow(/Invalid --ttl/);
    expect(() => parseTtl('h2')).toThrow(/Invalid --ttl/);
    expect(() => parseTtl('')).toThrow(/Invalid --ttl/);
  });
});

describe('clampTtl', () => {
  it('is a no-op inside the range', () => {
    expect(clampTtl(3600)).toBe(3600);
  });
});

describe('formatDuration', () => {
  it('formats hours and minutes', () => {
    expect(formatDuration(3600 + 30 * 60)).toBe('1h 30m');
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(3600)).toBe('1h');
  });
});

describe('parseSystemdLeft', () => {
  it('sums list-timers LEFT column text into seconds', () => {
    expect(parseSystemdLeft('1min 59s')).toBe(119);
    expect(parseSystemdLeft('2h 33min')).toBe(2 * 3600 + 33 * 60);
    expect(parseSystemdLeft('45s')).toBe(45);
  });
});

describe('parseListTimersJson', () => {
  it('computes remaining seconds from the epoch-microsecond `next` field', () => {
    const nowUsec = Date.now() * 1000;
    const stdout = JSON.stringify([
      {
        next: nowUsec + 300_000_000,
        left: nowUsec + 300_000_000,
        last: 0,
        passed: 0,
        unit: 'hub-qa-ttl.timer',
        activates: 'hub-qa-ttl.service',
      },
    ]);
    const seconds = parseListTimersJson(stdout, 'hub-qa-ttl.timer');
    expect(seconds).not.toBeNull();
    expect(seconds!).toBeGreaterThan(295);
    expect(seconds!).toBeLessThanOrEqual(300);
  });

  it('returns null when the unit is absent (disarmed) or output is unparseable', () => {
    expect(parseListTimersJson('[]', 'hub-qa-ttl.timer')).toBeNull();
    expect(parseListTimersJson('not json', 'hub-qa-ttl.timer')).toBeNull();
    expect(parseListTimersJson('{}', 'hub-qa-ttl.timer')).toBeNull();
  });
});

describe('disarmUnits', () => {
  it('stops timer and service from an interactive qa:down', () => {
    expect(disarmUnits(false)).toEqual(['hub-qa-ttl.timer', 'hub-qa-ttl.service']);
  });
  it('never stops the service it is running inside (the 2026-09-16 self-kill)', () => {
    expect(disarmUnits(true)).toEqual(['hub-qa-ttl.timer']);
  });
});
