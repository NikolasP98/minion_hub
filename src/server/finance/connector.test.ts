import { describe, it, expect } from 'vitest';
import { registerConnector, getConnector, type FinanceConnector } from './connector';

describe('connector registry', () => {
  it('registers and resolves a connector by provider', () => {
    const fake: FinanceConnector = { provider: 'fake', async *pull() {}, async *pullPages() {} };
    registerConnector(fake);
    expect(getConnector('fake')).toBe(fake);
    expect(getConnector('nope')).toBeNull();
  });
});
