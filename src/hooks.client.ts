import posthog from 'posthog-js';
import { PUBLIC_POSTHOG_KEY, PUBLIC_POSTHOG_HOST } from '$env/static/public';
import type { HandleClientError } from '@sveltejs/kit';

export async function init() {
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
	posthog.captureException(error);
	return { message, status };
};
