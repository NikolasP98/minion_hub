/**
 * Decide whether a click inside rendered chat markdown should be handled as an
 * in-app SPA navigation. Returns the internal href to pass to goto(), or null to
 * let the browser handle it normally.
 *
 * The assistant cites pages as `[label](/path)`; those should navigate within the
 * app (no full reload) — that click is the user's confirmation of the agent's
 * suggested navigation. External links, hash links, modified clicks (new tab /
 * middle click) and explicit target=_blank all fall through to the browser.
 *
 * Duck-typed (closest/getAttribute) so it's unit-testable without a real DOM.
 */
export interface ClickModifiers {
	metaKey: boolean;
	ctrlKey: boolean;
	shiftKey: boolean;
	button: number;
}

interface AnchorLike {
	getAttribute(name: string): string | null;
}
interface TargetLike {
	closest(sel: string): AnchorLike | null;
}

export function resolveInternalNav(target: unknown, e: ClickModifiers): string | null {
	const a = (target as TargetLike | null)?.closest?.('a') ?? null;
	const href = a?.getAttribute('href');
	if (!href || !href.startsWith('/')) return null; // external, hash, or no link
	if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return null; // new-tab / modified click
	if (a?.getAttribute('target') === '_blank') return null;
	return href;
}
