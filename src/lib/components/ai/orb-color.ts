// Colour math for the assistant orb (spec 019 amendment A). The body is tinted
// from the theme accent; the shader blends its stops in OkLab, so the stops are
// handed over already converted. OkLab transform: Björn Ottosson, public domain.

export type Lab = [number, number, number];

/** `#rrggbb` → sRGB 0..1, or null. */
export function hexToSrgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const toLinear = (u: number) => (u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4);
const toGamma = (u: number) =>
  u <= 0.0031308 ? u * 12.92 : 1.055 * Math.max(u, 0) ** (1 / 2.4) - 0.055;

export function srgbToOklab([r8, g8, b8]: [number, number, number]): Lab {
  const [r, g, b] = [r8, g8, b8].map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToHex([L, a, b]: Lab): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return (
    '#' +
    rgb
      .map((c) => Math.round(Math.min(1, Math.max(0, toGamma(c))) * 255))
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')
  );
}

const mix = (x: Lab, y: Lab, t: number): Lab => [
  x[0] + (y[0] - x[0]) * t,
  x[1] + (y[1] - x[1]) * t,
  x[2] + (y[2] - x[2]) * t,
];

export interface OrbPalette {
  /** Shader stops, OkLab: saturated body → near-white edge (range is what makes the marbling show). */
  stops: [Lab, Lab];
  /** CSS colours for the painted fallback and the eyes. */
  body: string;
  edge: string;
  feature: string;
}

const WHITE: Lab = [1, 0, 0];
const INK: Lab = [0.24, 0, 0];

/** Palette from the accent: body = accent, edge = accent mixed 90% toward white, eyes = accent 85% toward near-black. */
export function orbPalette(accentHex: string): OrbPalette {
  const body = srgbToOklab(hexToSrgb(accentHex) ?? [0.5, 0.5, 0.5]);
  const edge = mix(body, WHITE, 0.9);
  const feature = mix(body, INK, 0.85);
  return {
    stops: [body, edge],
    body: oklabToHex(body),
    edge: oklabToHex(edge),
    feature: oklabToHex(feature),
  };
}
