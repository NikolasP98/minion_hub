import { createMinionAuthClient } from '@minion-stack/auth/client';

export const authClient = createMinionAuthClient({
  baseURL: import.meta.env.VITE_BETTER_AUTH_URL,
});
