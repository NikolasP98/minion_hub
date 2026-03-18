import { building } from '$app/environment';
import { PUBLIC_POSTHOG_KEY, PUBLIC_POSTHOG_HOST } from '$env/static/public';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let posthogClient: any = null;

export async function getPostHogClient() {
	if (building || !PUBLIC_POSTHOG_KEY) return null;
	if (!posthogClient) {
		const { PostHog } = await import('posthog-node');
		posthogClient = new PostHog(PUBLIC_POSTHOG_KEY, {
			host: PUBLIC_POSTHOG_HOST,
			flushAt: 1,
			flushInterval: 0,
			requestTimeout: 3000,
			fetchRetryCount: 0,
			fetchRetryDelay: 0,
		});
		posthogClient.on('error', () => {});
	}
	return posthogClient;
}

export async function shutdownPostHog() {
	if (posthogClient) {
		try {
			await posthogClient.shutdown(3000);
		} catch {
			// ignore
		}
	}
}
