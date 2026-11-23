/** Shared browser/server text contract. Persisted defaults are never repaired on read. */
export const DEFAULT_BRAND_NAME = 'MINION';
export const HUB_NAME_MAX_GRAPHEMES = 15;
export const HUB_NAME_MAX_BYTES = 256;
export type Branding = {
  orgId: string | null;
  name: string;
  fullName: string;
  source: 'custom' | 'organization' | 'default';
  readStatus: 'ready' | 'unavailable';
};
export function brandingValidationAvailable(): boolean {
  try {
    return (
      typeof Intl.Segmenter === 'function' &&
      new RegExp('\\p{Extended_Pictographic}', 'u').test('👩') &&
      new RegExp('\\p{Emoji_Modifier}', 'u').test('🏽')
    );
  } catch {
    return false;
  }
}
export function hubNameLength(input: string): number {
  if (!brandingValidationAvailable()) return 0;
  return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(input))
    .length;
}
function normalized(input: string): string {
  return input
    .normalize('NFC')
    .replace(/\p{Zs}/gu, ' ')
    .replace(/ +/g, ' ')
    .replace(/^ | $/g, '');
}
export function validateHubName(
  input: unknown,
): { ok: true; value: string } | { ok: false; code: string } {
  if (!brandingValidationAvailable()) return { ok: false, code: 'unavailable' };
  if (typeof input !== 'string') return { ok: false, code: 'type' };
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(input)) return { ok: false, code: 'control' };
  const value = normalized(input);
  if (!value) return { ok: false, code: 'empty' };
  if (hubNameLength(value) > HUB_NAME_MAX_GRAPHEMES) return { ok: false, code: 'graphemes' };
  if (new TextEncoder().encode(value).length > HUB_NAME_MAX_BYTES)
    return { ok: false, code: 'bytes' };
  const emoji = new RegExp(
    '^(?:\\p{Extended_Pictographic}[\\uFE0E\\uFE0F]?\\p{Emoji_Modifier}?)(?:\\u200D\\p{Extended_Pictographic}[\\uFE0E\\uFE0F]?\\p{Emoji_Modifier}?)*$',
    'u',
  );
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
    value,
  )) {
    if (
      /[\u200D\uFE0E\uFE0F]/u.test(segment) &&
      !emoji.test(segment) &&
      !/^[0-9#*]\uFE0F?\u20E3$/u.test(segment)
    )
      return { ok: false, code: 'emoji' };
  }
  if (
    /\p{Cf}/u.test(value.replace(/\u200D/g, '')) ||
    /[\uFE00-\uFE0D\u{E0100}-\u{E01EF}]/u.test(value)
  )
    return { ok: false, code: 'format' };
  if (/(?:^| )hub$/iu.test(value)) return { ok: false, code: 'suffix' };
  return { ok: true, value };
}
export function suggestHubName(input: unknown): string | null {
  if (typeof input !== 'string' || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(input)) return null;
  const suggested = normalized(input)
    .replace(/(?:^| )hub$/iu, '')
    .trim();
  const result = validateHubName(suggested);
  return result.ok ? result.value : null;
}
export function resolveBranding(
  tenant: { id: string; name: string; hub_name?: string | null } | null,
  readStatus: Branding['readStatus'] = 'ready',
): Branding {
  const status = brandingValidationAvailable() ? readStatus : 'unavailable';
  let name = DEFAULT_BRAND_NAME;
  let source: Branding['source'] = 'default';
  if (tenant && status === 'ready') {
    const custom = validateHubName(tenant.hub_name);
    const suggestion = suggestHubName(tenant.name);
    if (custom.ok) {
      name = custom.value;
      source = 'custom';
    } else if (suggestion) {
      name = suggestion;
      source = 'organization';
    }
  }
  return { orgId: tenant?.id ?? null, name, fullName: `${name} Hub`, source, readStatus: status };
}
