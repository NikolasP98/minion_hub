/**
 * Build a DiceBear Notionists avatar URL for the given seed string.
 */
export function diceBearAvatarUrl(seed: string): string {
	return `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(seed)}&backgroundColor=transparent`;
}
