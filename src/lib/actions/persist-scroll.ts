// Persist a scroll container's scrollTop across navigations — even if the node is
// unmounted/remounted (SvelteKit re-renders the routed subtree on navigation, which
// can recreate a module's side-nav). The store is module-level so it outlives any
// single component instance; keyed so each nav keeps its own position. Works whether
// the node persists (natural scroll kept, store just tracks) or remounts (restored).
const positions = new Map<string, number>();

export function persistScroll(node: HTMLElement, key: string) {
	let k = key;
	const save = () => positions.set(k, node.scrollTop);
	const restore = () => {
		const v = positions.get(k);
		if (v != null) node.scrollTop = v;
	};
	// Restore now, then again after layout settles (content height may not be final
	// on the first tick after a remount, which would clamp an early scrollTop set).
	restore();
	requestAnimationFrame(restore);
	node.addEventListener('scroll', save, { passive: true });

	return {
		update(next: string) {
			if (next === k) return;
			save(); // stash the outgoing key before switching
			k = next;
			restore();
			requestAnimationFrame(restore);
		},
		destroy() {
			save();
			node.removeEventListener('scroll', save);
		},
	};
}
