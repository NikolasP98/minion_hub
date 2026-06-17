/**
 * Custom-field (jsonb `custom_fields`) presentation helpers.
 *
 * Contacts carry arbitrary metadata (for FaceSculptors: imported patient
 * attributes — dni, edad, sexo, distrito, …). Keys are data-defined, so the
 * label/icon/format logic is curated for the common imported keys and degrades
 * gracefully (humanized key) for anything else.
 *
 * Labels are resolved HERE (curated EN/ES via `languageTag()`) rather than
 * through paraglide message ids: the keys are runtime DATA, not UI strings, so a
 * fixed per-key i18n table is both simpler and immune to message-bundle drift.
 */
import { languageTag } from '$lib/paraglide/runtime';
import { formatPhoneLike } from './crm-format';

/** Curated EN/ES labels for the well-known imported keys. */
const LABELS: Record<string, { en: string; es: string }> = {
  dni: { en: 'ID (DNI)', es: 'DNI' },
  nombre: { en: 'Name', es: 'Nombre' },
  edad: { en: 'Age', es: 'Edad' },
  sexo: { en: 'Sex', es: 'Sexo' },
  telefono: { en: 'Phone', es: 'Teléfono' },
  email: { en: 'Email', es: 'Correo' },
  distrito: { en: 'District', es: 'Distrito' },
  domicilio: { en: 'Address', es: 'Domicilio' },
  direccion: { en: 'Address', es: 'Dirección' },
  motivo: { en: 'Reason', es: 'Motivo' },
  referencia: { en: 'Referral', es: 'Referencia' },
  ocupacion: { en: 'Occupation', es: 'Ocupación' },
  nacionalidad: { en: 'Nationality', es: 'Nacionalidad' },
  fecha_nacimiento: { en: 'Birth date', es: 'Fecha de nacimiento' },
};

/** Preferred ordering for the known keys; unknown keys follow, alphabetically. */
const KEY_ORDER = [
  'nombre',
  'dni',
  'edad',
  'fecha_nacimiento',
  'sexo',
  'nacionalidad',
  'telefono',
  'email',
  'distrito',
  'domicilio',
  'direccion',
  'ocupacion',
  'motivo',
  'referencia',
];

/** Keys whose value should be formatted as a phone number. */
const PHONE_KEYS = new Set(['telefono', 'phone', 'celular', 'movil', 'whatsapp', 'tel']);
/** Keys whose value is an email (rendered as a mailto link by the UI). */
const EMAIL_KEYS = new Set(['email', 'correo', 'mail']);

/** A human label for a custom-field key (curated EN/ES → humanized fallback). */
export function metaLabel(key: string): string {
  const hit = LABELS[key.toLowerCase()];
  if (hit) return languageTag() === 'es' ? hit.es : hit.en;
  // snake/camel → spaced, capitalized ("birth_date" → "Birth date").
  const spaced = key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Raw value as a display string ("" / null become "—"). */
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

/** Value formatted for its key (phones spaced into triplets, etc.). */
export function metaDisplay(key: string, value: unknown): string {
  const s = metaValue(value);
  if (s === '—') return s;
  if (PHONE_KEYS.has(key.toLowerCase())) return formatPhoneLike(s);
  return s;
}

export function isEmailKey(key: string): boolean {
  return EMAIL_KEYS.has(key.toLowerCase());
}

const orderIndex = (k: string) => {
  const i = KEY_ORDER.indexOf(k.toLowerCase());
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
};

/**
 * Reserved custom-field keys are system-owned (e.g. `_funnel` holds the
 * marketing-funnel stage). They live in `custom_fields` to avoid a migration
 * but must NEVER surface as user-facing "properties" — filtered out of the
 * Details card and the Customers column editor by their `_` prefix.
 */
export const isReservedMetaKey = (k: string): boolean => k.startsWith('_');

/** Non-empty custom-field entries, ordered (known keys first, then the rest). */
export function metaEntries(fields: Record<string, unknown> | null | undefined): [string, unknown][] {
  if (!fields || typeof fields !== 'object') return [];
  const entries = Object.entries(fields).filter(
    ([k, v]) => !isReservedMetaKey(k) && v != null && String(v).trim() !== '',
  );
  return entries.sort(([a], [b]) => orderIndex(a) - orderIndex(b) || a.localeCompare(b));
}

/** Distinct custom-field keys present across a roster (for the column editor). */
export function collectMetaKeys(
  rows: { custom_fields?: Record<string, unknown> | null }[],
): string[] {
  const seen = new Set<string>();
  for (const r of rows) {
    const f = r.custom_fields;
    if (f && typeof f === 'object')
      for (const k of Object.keys(f)) if (k && !isReservedMetaKey(k)) seen.add(k);
  }
  return [...seen].sort((a, b) => orderIndex(a) - orderIndex(b) || a.localeCompare(b));
}
