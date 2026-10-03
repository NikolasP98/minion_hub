import { beforeEach, describe, expect, it, vi } from 'vitest';
const monitor = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock('@sentry/sveltekit', () => ({ captureException: monitor.capture }));
import { reportStoredMoneyFailure } from './telemetry';
import { PosError } from './errors';

beforeEach(() => {
  monitor.capture.mockReset();
});
describe('stored money failure monitoring', () => {
  it('reports one sanitized operational event without field values or supplied metadata', () => {
    const error = new PosError('customer-secret supplied value', 'invalid_stored_amount');
    reportStoredMoneyFailure(error);
    expect(monitor.capture).toHaveBeenCalledOnce();
    const [reported, context] = monitor.capture.mock.calls[0];
    expect(reported).not.toBe(error);
    expect(reported.message).toBe('POS stored monetary data failed validation');
    expect(JSON.stringify(context)).not.toContain('customer-secret');
    expect(context.tags).toEqual({ area: 'pos', code: 'invalid_stored_amount' });
  });
  it('does not report ordinary input rejection and contains a throwing observer', () => {
    reportStoredMoneyFailure(new PosError('bad input', 'invalid_amount'));
    expect(monitor.capture).not.toHaveBeenCalled();
    monitor.capture.mockImplementation(() => {
      throw new Error('observer offline');
    });
    expect(() =>
      reportStoredMoneyFailure(new PosError('bad stored value', 'invalid_stored_amount')),
    ).not.toThrow();
  });
});
