/**
 * HC-043 — valid CSS colour conversion for contrast measurement.
 *
 * Parses the colour strings Chromium reports from `getComputedStyle` (hex,
 * rgb()/rgba(), oklab(), oklch(), color(srgb …), transparent), converts
 * Oklab/Oklch to sRGB per CSS Color 4, alpha-composites the rendered layer
 * stack in sRGB (what Chromium does for element backgrounds) and computes the
 * WCAG 2.x contrast ratio. Shared by the vitest contract and the browser
 * fixture so both sides use one conversion.
 */

/** sRGB in 0..255 plus alpha 0..1. */
export type Rgba = [number, number, number, number];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Linear-light → sRGB transfer (CSS Color 4 §10.2). */
export function gammaEncode(c: number): number {
  const v = clamp01(c);
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

/** sRGB 0..255 → linear-light 0..1. */
export function linearize(channel255: number): number {
  const n = channel255 / 255;
  return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
}

/** Oklab (L 0..1, a, b) → sRGB 0..255 (CSS Color 4 §14.2 matrices). */
export function oklabToSrgb(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [gammaEncode(r) * 255, gammaEncode(g) * 255, gammaEncode(bl) * 255];
}

function num(token: string, scale = 1): number {
  const t = token.trim();
  if (t === 'none') return 0;
  if (t.endsWith('%')) return (Number.parseFloat(t) / 100) * scale;
  return Number.parseFloat(t);
}

function alphaOf(parts: string[]): number {
  const slash = parts.indexOf('/');
  if (slash === -1) return 1;
  const a = parts[slash + 1] ?? '1';
  return a.endsWith('%') ? Number.parseFloat(a) / 100 : Number.parseFloat(a);
}

/** Parse any colour string Chromium or tokens.css can hand us. Throws on unknown syntax. */
export function parseCssColor(input: string): Rgba {
  const s = input.trim().toLowerCase();
  if (s === 'transparent') return [0, 0, 0, 0];
  if (s.startsWith('#')) {
    const h = s.slice(1);
    const full =
      h.length === 3 || h.length === 4
        ? h
            .split('')
            .map((c) => c + c)
            .join('')
        : h;
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(full)) throw new Error(`bad hex colour: ${input}`);
    const v = (i: number) => Number.parseInt(full.slice(i, i + 2), 16);
    return [v(0), v(2), v(4), full.length === 8 ? v(6) / 255 : 1];
  }
  const m = /^([a-z]+)\((.*)\)$/.exec(s);
  if (!m) throw new Error(`unsupported colour syntax: ${input}`);
  const fn = m[1];
  const body = m[2].replace(/,/g, ' ').replace(/\s*\/\s*/g, ' / ');
  const parts = body.split(/\s+/).filter(Boolean);
  const alpha = alphaOf(parts);
  const args = parts.slice(0, parts.indexOf('/') === -1 ? parts.length : parts.indexOf('/'));
  switch (fn) {
    case 'rgb':
    case 'rgba': {
      const [r, g, b, legacyA] = args;
      const a = legacyA !== undefined ? num(legacyA) : alpha;
      return [num(r, 255), num(g, 255), num(b, 255), a];
    }
    case 'oklab': {
      const [L, a, b] = args;
      const [r, g, bl] = oklabToSrgb(num(L, 1), num(a, 0.4), num(b, 0.4));
      return [r, g, bl, alpha];
    }
    case 'oklch': {
      const [L, C, h] = args;
      const hue = ((num(h) % 360) * Math.PI) / 180;
      const c = num(C, 0.4);
      const [r, g, bl] = oklabToSrgb(num(L, 1), c * Math.cos(hue), c * Math.sin(hue));
      return [r, g, bl, alpha];
    }
    case 'color': {
      const [space, r, g, b] = args;
      if (space !== 'srgb') throw new Error(`unsupported color() space: ${input}`);
      return [num(r, 1) * 255, num(g, 1) * 255, num(b, 1) * 255, alpha];
    }
    default:
      throw new Error(`unsupported colour function: ${input}`);
  }
}

/**
 * Composite a stack of layers, nearest-to-the-text FIRST, over an opaque root.
 * Source-over in sRGB (Chromium's element background blending). The root must
 * be opaque; throws if the stack never reaches an opaque layer.
 */
export function composite(layersTopFirst: Rgba[]): [number, number, number] {
  const idx = layersTopFirst.findIndex((l) => l[3] >= 1);
  if (idx === -1) throw new Error('layer stack has no opaque background');
  let [r, g, b] = layersTopFirst[idx];
  for (let i = idx - 1; i >= 0; i--) {
    const [sr, sg, sb, sa] = layersTopFirst[i];
    r = sr * sa + r * (1 - sa);
    g = sg * sa + g * (1 - sa);
    b = sb * sa + b * (1 - sa);
  }
  return [r, g, b];
}

export function relativeLuminance([r, g, b]: readonly [number, number, number]): number {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** WCAG 2.x contrast ratio between two opaque sRGB colours (0..255 channels). */
export function contrast(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const toHex = (c: readonly [number, number, number]) =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** Round-trip proof: the shipped new-york `--color-danger-fg` is #fca5a5, which Chromium
 * reports as `oklab(0.80769 0.0975416 0.034682)` once Tailwind's `/15` colour-mix runs. */
export const OKLAB_SELF_CHECK = {
  input: 'oklab(0.80769 0.0975416 0.034682 / 0.15)',
  expectedOpaqueHex: '#fca5a5',
} as const;
