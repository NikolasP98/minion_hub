import { describe, expect, it } from 'vitest';
import { isCronAuthPath } from './cron-auth-path';

describe('isCronAuthPath', () => {
  it('allows the CRM rollup scheduler to reach its bearer-authenticated handler', () => {
    expect(isCronAuthPath('/api/crm/insights/word-frequency/refresh')).toBe(true);
    expect(isCronAuthPath('/api/crm/insights/word-frequency/refresh/full')).toBe(true);
  });

  it('does not bypass user authentication for neighboring CRM routes', () => {
    expect(isCronAuthPath('/api/crm/insights/word-frequency')).toBe(false);
    expect(isCronAuthPath('/api/crm/insights/word-frequency/refresh/extra')).toBe(false);
  });
});
