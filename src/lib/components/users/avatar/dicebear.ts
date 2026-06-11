// DiceBear avatar presets (https://www.dicebear.com — open-source, MIT-licensed
// avatar styles served as plain SVG over HTTP). We store the resulting URL on
// the profile, so the picker only needs to build deterministic URLs.
//
// The seed is an opaque, non-PII token (the user id) so the same person always
// gets the same generated face. We deliberately avoid seeding with email/name
// to keep PII off the third-party request.

const BASE = 'https://api.dicebear.com/9.x';

/** Curated styles, each a visually distinct "library" of looks. */
export const DICEBEAR_STYLES = [
  { id: 'notionists', label: 'Sketch' },
  { id: 'lorelei', label: 'Line' },
  { id: 'avataaars', label: 'Classic' },
  { id: 'big-smile', label: 'Smile' },
  { id: 'fun-emoji', label: 'Emoji' },
  { id: 'bottts', label: 'Bot' },
  { id: 'thumbs', label: 'Thumb' },
  { id: 'shapes', label: 'Shapes' },
  { id: 'glass', label: 'Glass' },
  { id: 'identicon', label: 'Ident' },
  { id: 'rings', label: 'Rings' },
  { id: 'pixel-art', label: 'Pixel' },
] as const;

export type DicebearStyle = (typeof DICEBEAR_STYLES)[number];

/** Build the SVG URL for a style + seed. */
export function dicebearUrl(style: string, seed: string): string {
  const s = encodeURIComponent(seed || 'minion');
  return `${BASE}/${style}/svg?seed=${s}`;
}

/** One preset per curated style, all sharing the same seed. */
export function dicebearPresets(seed: string): { style: string; label: string; url: string }[] {
  return DICEBEAR_STYLES.map((s) => ({ style: s.id, label: s.label, url: dicebearUrl(s.id, seed) }));
}
