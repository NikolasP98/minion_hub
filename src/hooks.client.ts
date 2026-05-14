import type { HandleClientError } from '@sveltejs/kit';

export async function init() {
  // D-08: skip PostHog initialization in desktop mode
  if (import.meta.env.VITE_DESKTOP) return;

  const posthog = (await import('posthog-js')).default;
  const { env } = await import('$env/dynamic/public');

  if (!env.PUBLIC_POSTHOG_KEY) return;

  posthog.init(env.PUBLIC_POSTHOG_KEY, {
    api_host: `${window.location.origin}/ingest`,
    ui_host: env.PUBLIC_POSTHOG_HOST,
    defaults: '2026-01-30',
    capture_exceptions: true,
    // Disable PostHog's history.pushState/replaceState monkey-patch. SvelteKit's
    // router warns about direct history manipulation, and PostHog's default
    // `'history_change'` pageview tracker triggers that warning on every nav.
    // We capture pageviews manually via `afterNavigate` in `+layout.svelte`.
    capture_pageview: false,
    capture_pageleave: 'if_capture_pageview',
  });
  // Expose for browser console debugging
  (window as Window & { posthog?: typeof posthog }).posthog = posthog;
}

export const handleError: HandleClientError = async ({ error, status, message }) => {
  // Only capture exceptions if PostHog was initialized (non-desktop)
  if (!import.meta.env.VITE_DESKTOP) {
    const posthog = (await import('posthog-js')).default;
    posthog.captureException(error);
  }
  return { message, status };
};
