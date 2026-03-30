import { dev } from '$app/environment';

// D-07: skip Vercel analytics in desktop mode
if (!import.meta.env.VITE_DESKTOP) {
  const { injectAnalytics } = await import('@vercel/analytics/sveltekit');
  injectAnalytics({ mode: dev ? 'development' : 'production' });
}

export const ssr = false;
export const prerender = false;
