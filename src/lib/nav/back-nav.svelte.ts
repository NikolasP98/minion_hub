import { goto, afterNavigate } from '$app/navigation';
import * as m from '$lib/paraglide/messages';

/**
 * Dynamic "back" target for detail pages.
 *
 * Remembers the in-app page the user arrived from (via afterNavigate). `go()`
 * pops real browser history when there's an in-app referrer (so you land back
 * exactly where you were — e.g. a customer page, not the generic list), and
 * falls back to the section index on hard loads / external entry.
 *
 * Must be called during component init (afterNavigate requirement).
 * ponytail: relies on SvelteKit nav.from — null on first load, so we degrade
 * to the fallback. No history tracking beyond one hop needed.
 */
export function createBackNav(fallback: string, fallbackLabel: () => string) {
	let from = $state<string | null>(null);
	afterNavigate((nav) => {
		if (nav.from && nav.from.url.pathname !== nav.to?.url.pathname) {
			from = nav.from.url.pathname + nav.from.url.search;
		} else if (!nav.from && typeof document !== 'undefined' && document.referrer) {
			// Fallback: extract path+search from document.referrer for direct loads
			try {
				const refUrl = new URL(document.referrer);
				if (refUrl.origin === location.origin && refUrl.pathname !== nav.to?.url.pathname) {
					from = refUrl.pathname + refUrl.search;
				}
			} catch {}
		}
	});
	return {
		// Generic "Back" once we know the real referrer; contextual label otherwise.
		get label() {
			return from ? m.common_back() : fallbackLabel();
		},
		go() {
			if (from) history.back();
			else goto(fallback);
		},
	};
}
