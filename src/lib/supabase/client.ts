import { createBrowserClient } from '@supabase/ssr';
import { env } from '$env/dynamic/public';

type BrowserSupabaseClient = ReturnType<typeof createBrowserClient>;

let browserClient: BrowserSupabaseClient | null = null;

/**
 * One Supabase client per browser tab.
 *
 * Realtime multiplexes channels over the client's single WebSocket. Creating a
 * client per component would create parallel sockets, duplicate auth refresh
 * work, and multiply private-channel authorization checks as the UI grows.
 */
export const supabaseBrowser = (): BrowserSupabaseClient => {
  browserClient ??= createBrowserClient(
    env.PUBLIC_SUPABASE_URL ?? '',
    env.PUBLIC_SUPABASE_ANON_KEY ?? '',
  );
  return browserClient;
};
