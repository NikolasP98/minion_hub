import { dev } from '$app/environment';

// D-07: skip Vercel telemetry in desktop mode
// Use void IIFE to avoid top-level await (not supported in browser ES2020 targets)
// Sole injection point — +layout.svelte used to inject a second copy eagerly.
if (!import.meta.env.VITE_DESKTOP) {
  void (async () => {
    const [{ injectAnalytics }, { injectSpeedInsights }] = await Promise.all([
      import('@vercel/analytics/sveltekit'),
      import('@vercel/speed-insights/sveltekit'),
    ]);
    injectAnalytics({ mode: dev ? 'development' : 'production' });
    injectSpeedInsights();
  })();
}

// TODO(handoff): First-document branding needs an SSR compatibility audit; this app
// currently initializes in the browser. See minion-meta proposal
// proposals/2026-11-22-hub-first-document-ssr.md and spec 145 implementation evidence.
export const ssr = false;
export const prerender = false;
