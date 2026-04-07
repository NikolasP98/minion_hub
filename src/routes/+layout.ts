import { dev } from '$app/environment';

// D-07: skip Vercel analytics in desktop mode
// Use void IIFE to avoid top-level await (not supported in browser ES2020 targets)
if (!import.meta.env.VITE_DESKTOP) {
  void (async () => {
    const { injectAnalytics } = await import('@vercel/analytics/sveltekit');
    injectAnalytics({ mode: dev ? 'development' : 'production' });
  })();
}

export const ssr = false;
export const prerender = false;
