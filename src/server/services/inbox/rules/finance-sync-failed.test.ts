import { describe, it, expect } from 'vitest';
import { isSyncFailed } from './finance-sync-failed';

describe('finance.sync_failed — isSyncFailed boundary', () => {
  it('"failed" IS a failure', () => {
    expect(isSyncFailed('failed')).toBe(true);
  });

  it('"success" is NOT a failure', () => {
    expect(isSyncFailed('success')).toBe(false);
  });

  it('never synced (null) is NOT a failure', () => {
    expect(isSyncFailed(null)).toBe(false);
  });
});
