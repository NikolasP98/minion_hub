import type { HandleClientError } from '@sveltejs/kit';

export async function init() {
	// D-08: skip PostHog initialization in desktop mode
	if (import.meta.env.VITE_DESKTOP) return;

	const posthog = (await import('posthog-js')).default;
	const { PUBLIC_POSTHOG_KEY, PUBLIC_POSTHOG_HOST } = await import('$env/static/public');

	posthog.init(PUBLIC_POSTHOG_KEY, {
		api_host: `${window.location.origin}/ingest`,
		ui_host: PUBLIC_POSTHOG_HOST,
		defaults: '2026-01-30',
		capture_exceptions: true,
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
