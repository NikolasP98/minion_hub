import { describe, it, expect } from 'vitest';

describe('gateway-rpc helper', () => {
  it('exports gatewayCall and pluginsUiList', async () => {
    const mod = await import('./gateway-rpc');
    expect(typeof mod.gatewayCall).toBe('function');
    expect(typeof mod.pluginsUiList).toBe('function');
  });
});
