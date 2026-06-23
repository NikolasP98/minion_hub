// DiceBear avatar URLs. Human users (and any unclassified seed) get the
// `notionists` sketch style; agents get a per-archetype style. `disco` is a
// 10.x-only style, so the whole app is pinned to the 10.x API. Note: 10.x
// rejects `backgroundColor=transparent` (transparent is already the default),
// so we omit it.
const BASE = 'https://api.dicebear.com/10.x';

/** DiceBear style per agent archetype. Anything else → notionists (users). */
export const ARCHETYPE_AVATAR_STYLE: Record<string, string> = {
  autonomous: 'glass',
  brain: 'disco',
  copilot: 'bottts-neutral',
};

/**
 * Build a DiceBear avatar URL for the given seed. Pass an agent `archetype`
 * (copilot/brain/autonomous) to pick its style; omit it for human users.
 */
export function diceBearAvatarUrl(seed: string, archetype?: string | null): string {
  const style = (archetype && ARCHETYPE_AVATAR_STYLE[archetype]) || 'notionists';
  return `${BASE}/${style}/svg?seed=${encodeURIComponent(seed)}`;
}
