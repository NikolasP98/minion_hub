// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { reportCrmTagBulkFailure } from './crm-tag-bulk-monitor';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('reports bounded categories without content and contains SDK failures', () => {
  let now = 100;
  vi.spyOn(window.performance, 'now').mockImplementation(() => now);
  const capture = vi.fn().mockImplementationOnce(() => {
    throw new Error('SDK unavailable');
  });
  vi.stubGlobal('posthog', { capture });
  expect(() => reportCrmTagBulkFailure('unknown')).not.toThrow();
  reportCrmTagBulkFailure('partial');
  expect(capture).toHaveBeenCalledTimes(1);
  now += 60_000;
  reportCrmTagBulkFailure('committed-refresh-failed');
  expect(capture.mock.calls).toEqual([
    ['crm_bulk_tag_failure', { outcome: 'unknown', schema_version: 1 }],
    ['crm_bulk_tag_failure', { outcome: 'committed-refresh-failed', schema_version: 1 }],
  ]);
});
it('does not create a monitoring client when none exists', () => {
  // Exercise the absent-client branch beyond the preceding test's rate limit.
  vi.spyOn(window.performance, 'now').mockReturnValue(1_000_000);
  expect(() => reportCrmTagBulkFailure('failed')).not.toThrow();
  expect('posthog' in window).toBe(false);
});
