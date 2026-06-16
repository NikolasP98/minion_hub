/**
 * Custom-field (jsonb `custom_fields`) presentation helpers.
 *
 * Contacts carry arbitrary metadata (for FaceSculptors: imported patient
 * attributes — dni, edad, sexo, distrito, …). Keys are data-defined, so we
 * humanize unknown keys generically and give the common imported keys a curated
 * localized label + a stable display order.
 */
import * as m from '$lib/paraglide/messages';

/** Curated labels for the well-known imported keys (everything else humanizes). */
const KNOWN_LABELS: Record<string, () => string> = {
  dni: () => m.crm_meta_dni(),
  edad: () => m.crm_meta_edad(),
  sexo: () => m.crm_meta_sexo(),
  email: () => m.crm_meta_email(),
  telefono: () => m.crm_meta_telefono(),
  distrito: () => m.crm_meta_distrito(),
  motivo: () => m.crm_meta_motivo(),
  referencia: () => m.crm_meta_referencia(),
  nombre: () => m.crm_meta_nombre(),
};

/** Preferred ordering for the known keys; unknown keys follow, alphabetically. */
const KEY_ORDER = [
  'dni',
  'nombre',
  'edad',
  'sexo',
  'telefono',
  'email',
  'distrito',
  'motivo',
  'referencia',
];

/** A human label for a custom-field key (curated → humanized fallback). */
export function metaLabel(key: string): string {
  const known = KNOWN_LABELS[key.toLowerCase()];
  if (known) return known();
  // snake/camel → spaced, capitalized first letter ("birth_date" → "Birth date").
  const spaced = key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Render a custom-field value as a display string ("" / null become "—"). */
export function metaValue(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'string') return value.trim() || '—';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Non-empty custom-field entries, ordered (known keys first, then the rest). */
export function metaEntries(fields: Record<string, unknown> | null | undefined): [string, unknown][] {
  if (!fields || typeof fields !== 'object') return [];
  const entries = Object.entries(fields).filter(([, v]) => v != null && String(v).trim() !== '');
  return entries.sort(([a], [b]) => {
    const ia = KEY_ORDER.indexOf(a.toLowerCase());
    const ib = KEY_ORDER.indexOf(b.toLowerCase());
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
}

/** Distinct custom-field keys present across a roster (for the column editor). */
export function collectMetaKeys(
  rows: { custom_fields?: Record<string, unknown> | null }[],
): string[] {
  const seen = new Set<string>();
  for (const r of rows) {
    const f = r.custom_fields;
    if (f && typeof f === 'object') for (const k of Object.keys(f)) if (k) seen.add(k);
  }
  const keys = [...seen];
  return keys.sort((a, b) => {
    const ia = KEY_ORDER.indexOf(a.toLowerCase());
    const ib = KEY_ORDER.indexOf(b.toLowerCase());
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
}
