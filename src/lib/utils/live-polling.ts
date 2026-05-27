import { invalidate } from '$app/navigation';

/**
 * Start a setInterval that calls invalidate(depKey) every `intervalMs` ms.
 * Returns a cleanup function — call it from onMount's return value or onDestroy.
 *
 * Usage:
 *   onMount(() => startPolling('app:dashboard', 5000));
 *
 * The corresponding +page.server.ts must declare `event.depends('app:dashboard')`
 * for invalidate to actually trigger a reload.
 */
export function startPolling(depKey: string, intervalMs = 5000): () => void {
	const id = setInterval(() => {
		void invalidate(depKey);
	}, intervalMs);
	return () => clearInterval(id);
}
