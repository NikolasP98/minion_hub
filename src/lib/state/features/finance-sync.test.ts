import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { financeSync } from './finance-sync.svelte';

beforeEach(() => { vi.restoreAllMocks(); financeSync.stop(); });
afterEach(() => financeSync.stop());

function statusResponse(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
}

describe('financeSync.refresh', () => {
  it('reads an active job into state', async () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(statusResponse({ active: true, status: 'running', total: 200, processed: 50 }) as never);
    await financeSync.refresh('susii');
    expect(financeSync.active).toBe(true);
    expect(financeSync.processed).toBe(50);
    expect(financeSync.percent).toBe(25);
  });

  it('percent is 0 when total is unknown', async () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(statusResponse({ active: true, status: 'running', total: null, processed: 7 }) as never);
    await financeSync.refresh('susii');
    expect(financeSync.percent).toBe(0);
  });
});
