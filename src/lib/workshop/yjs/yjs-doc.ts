import * as Y from 'yjs';

let doc: Y.Doc | null = null;

/** Get or create the shared Y.Doc for the workshop. */
export function getWorkshopDoc(): Y.Doc {
	if (!doc) {
		doc = new Y.Doc();
	}
	return doc;
}

/** Destroy the current doc (e.g., on disconnect/cleanup). */
export function destroyWorkshopDoc(): void {
	if (doc) {
		doc.destroy();
		doc = null;
	}
}

/**
 * Get the typed shared maps from the workshop Y.Doc.
 * Each map corresponds to a WorkshopState slice.
 */
export function getWorkshopMaps(d: Y.Doc) {
	return {
		agents: d.getMap('agents'),
		elements: d.getMap('elements'),
		relationships: d.getMap('relationships'),
		settings: d.getMap('settings'),
		conversations: d.getMap('conversations'),
		meta: d.getMap('meta'),
	};
}
