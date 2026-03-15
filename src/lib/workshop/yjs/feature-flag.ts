const STORAGE_KEY = 'workshop:collab';

/** Whether workshop Yjs collaboration is enabled. Default: false. */
export function isCollabEnabled(): boolean {
	if (typeof localStorage === 'undefined') return false;
	try {
		return localStorage.getItem(STORAGE_KEY) === 'true';
	} catch {
		return false;
	}
}

/** Enable or disable workshop collaboration. */
export function setCollabEnabled(enabled: boolean): void {
	if (typeof localStorage === 'undefined') return;
	try {
		if (enabled) {
			localStorage.setItem(STORAGE_KEY, 'true');
		} else {
			localStorage.removeItem(STORAGE_KEY);
		}
	} catch { /* ignore */ }
}
