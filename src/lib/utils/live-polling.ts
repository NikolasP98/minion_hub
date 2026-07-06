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
 *
 * Skips interval ticks while the tab is hidden (halves idle traffic), and
 * refetches immediately when the tab regains focus/visibility so data isn't
 * stale for however long the user was away.
 */
export function startPolling(depKey: string, intervalMs = 5000): () => void {
	const id = setInterval(() => {
		if (document.hidden) return;
		void invalidate(depKey);
	}, intervalMs);

	const onFocusRefetch = () => void invalidate(depKey);
	const onVisibilityChange = () => {
		if (!document.hidden) onFocusRefetch();
	};
	document.addEventListener('visibilitychange', onVisibilityChange);
	window.addEventListener('focus', onFocusRefetch);

	return () => {
		clearInterval(id);
		document.removeEventListener('visibilitychange', onVisibilityChange);
		window.removeEventListener('focus', onFocusRefetch);
	};
}
