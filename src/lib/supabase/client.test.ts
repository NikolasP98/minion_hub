import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  client: { id: 'browser-supabase-client' },
  createBrowserClient: vi.fn(),
}));

mocks.createBrowserClient.mockReturnValue(mocks.client);

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: mocks.createBrowserClient,
}));

import { supabaseBrowser } from './client';

describe('supabaseBrowser', () => {
  it('reuses one client so Realtime channels multiplex over one tab socket', () => {
    const first = supabaseBrowser();
    const second = supabaseBrowser();

    expect(first).toBe(second);
    expect(mocks.createBrowserClient).toHaveBeenCalledTimes(1);
  });
});
