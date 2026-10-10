import type { HandleClientError } from '@sveltejs/kit';
// Use static (build-time inlined) public env, not dynamic. Dynamic public env
// reads `globalThis.__sveltekit_<hash>.env` at runtime, which throws on the
// client when a deploy serves a server/client build with mismatched hashes.
import { PUBLIC_POSTHOG_KEY, PUBLIC_POSTHOG_HOST } from '$env/static/public';
import { isStaleChunkError, shouldReloadForStaleChunk } from '$lib/analytics/stale-chunk';
import { track } from '$lib/analytics/track';

export function init() {
  // D-08: skip PostHog initialization in desktop mode
  if (import.meta.env.VITE_DESKTOP) return;

  if (!PUBLIC_POSTHOG_KEY) return;

  // Defer to first idle: posthog-js is ~213KB and has no business on the
  // boot-critical path. The initial $pageview is captured here on init since
  // the afterNavigate hook in +layout.svelte fires before posthog exists.
  const start = async () => {
    const posthog = (await import('posthog-js')).default;

    posthog.init(PUBLIC_POSTHOG_KEY, {
      api_host: `${window.location.origin}/ingest`,
      ui_host: PUBLIC_POSTHOG_HOST,
      defaults: '2026-01-30',
      capture_exceptions: true,
      // Disable PostHog's history.pushState/replaceState monkey-patch. SvelteKit's
      // router warns about direct history manipulation, and PostHog's default
      // `'history_change'` pageview tracker triggers that warning on every nav.
      // We capture pageviews manually via `afterNavigate` in `+layout.svelte`.
      capture_pageview: false,
      capture_pageleave: 'if_capture_pageview',
      // Own web vitals in code — remote-config-only capture silently degrades
      // (idle-deferred init loses buffered entries) and can be toggled off
      // project-side without any trace in the repo.
      capture_performance: { web_vitals: true },
    });
    // Expose for browser console debugging
    (window as Window & { posthog?: typeof posthog }).posthog = posthog;
    posthog.capture('$pageview');
  };
  if ('requestIdleCallback' in window) requestIdleCallback(() => void start(), { timeout: 3000 });
  else setTimeout(() => void start(), 1000);
}

export const handleError: HandleClientError = async ({ error, status, message }) => {
  // Surface the real cause in the console — PostHog capture alone made prod
  // failures undiagnosable (error page with zero local signal).
  console.error('[handleError]', status, message, error);
  // Only capture exceptions if PostHog was initialized (non-desktop)
  if (!import.meta.env.VITE_DESKTOP) {
    const posthog = (await import('posthog-js')).default;
    posthog.captureException(error);
  }
  // A deploy can rotate the `_app/immutable` chunk hashes while a tab is
  // open; the NEXT lazy import() 404s before SvelteKit's own full-reload
  // guard (+layout.svelte's `updated.current` check) ever runs. Reload once
  // (guarded to once/60s via sessionStorage) rather than leave the tab dead.
  try {
    if (isStaleChunkError(message) && shouldReloadForStaleChunk(Date.now(), sessionStorage)) {
      track('app_chunk_reload', { status });
      location.reload();
    }
  } catch {
    // Referencing sessionStorage itself can throw (sandboxed iframe); a
    // reload-on-deploy convenience must never crash error handling.
  }
  return { message, status };
};
