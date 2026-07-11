import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  armEagerReconnect,
  clearPendingEagerReconnect,
  disarmEagerReconnect,
  hasPendingEagerReconnect,
  isEagerReconnectArmed,
  scheduleEagerReconnect,
} from './eager-reconnect';

describe('eager-reconnect scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    disarmEagerReconnect();
  });

  afterEach(() => {
    disarmEagerReconnect();
    vi.useRealTimers();
  });

  it('is not armed before arm() is called', () => {
    expect(isEagerReconnectArmed()).toBe(false);
  });

  it('is armed immediately after arm() and disarmed after the window expires', () => {
    armEagerReconnect(180_000);
    expect(isEagerReconnectArmed()).toBe(true);

    vi.advanceTimersByTime(179_999);
    expect(isEagerReconnectArmed()).toBe(true);

    vi.advanceTimersByTime(2);
    expect(isEagerReconnectArmed()).toBe(false);
  });

  it('disarm() immediately clears the armed window', () => {
    armEagerReconnect();
    expect(isEagerReconnectArmed()).toBe(true);
    disarmEagerReconnect();
    expect(isEagerReconnectArmed()).toBe(false);
  });

  it('schedules a flat ~750-1000ms attempt and fires exactly once', () => {
    const fn = vi.fn();
    scheduleEagerReconnect(fn);
    expect(hasPendingEagerReconnect()).toBe(true);

    vi.advanceTimersByTime(749);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(251); // covers max jitter (750 + 250)
    expect(fn).toHaveBeenCalledTimes(1);
    expect(hasPendingEagerReconnect()).toBe(false);
  });

  it('does not stack timers — a second schedule replaces the first', () => {
    const first = vi.fn();
    const second = vi.fn();
    scheduleEagerReconnect(first);
    scheduleEagerReconnect(second);

    vi.advanceTimersByTime(1001);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('clearPendingEagerReconnect cancels a scheduled attempt', () => {
    const fn = vi.fn();
    scheduleEagerReconnect(fn);
    clearPendingEagerReconnect();
    expect(hasPendingEagerReconnect()).toBe(false);

    vi.advanceTimersByTime(2000);
    expect(fn).not.toHaveBeenCalled();
  });

  it('disarmEagerReconnect also cancels a scheduled attempt', () => {
    const fn = vi.fn();
    armEagerReconnect();
    scheduleEagerReconnect(fn);
    disarmEagerReconnect();

    vi.advanceTimersByTime(2000);
    expect(fn).not.toHaveBeenCalled();
    expect(isEagerReconnectArmed()).toBe(false);
  });
});
