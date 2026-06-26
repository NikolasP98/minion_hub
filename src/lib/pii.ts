/**
 * Field-level (Phase 4) PII redaction: keep the last 4 chars of a phone / email /
 * handle, mask the rest (`•••••6833`). Short values are fully masked. Used by the
 * CRM + scheduling services when the caller's field level is below the sensitive
 * threshold. Pure + client-safe so it lives in $lib.
 */
export function maskPii(value: string | null | undefined): string {
  if (!value) return '';
  const v = String(value);
  const tail = v.slice(-4);
  return v.length <= 4 ? '•'.repeat(v.length) : '•'.repeat(Math.min(v.length - 4, 8)) + tail;
}

/**
 * CRM custom_fields keys holding PII (phone / email / government id). Imported
 * patient attributes land here as data-defined keys; these are the ones the
 * Customers list + contact detail render as Phone / ID columns. Mirrors the
 * phone/email key sets in `crm-meta.ts` plus the common id variants.
 */
export const CRM_PII_FIELD_KEYS = new Set([
  'telefono', 'phone', 'celular', 'movil', 'whatsapp', 'tel',
  'email', 'correo', 'mail',
  'dni', 'documento', 'document', 'doc', 'cedula', 'ruc', 'pasaporte', 'passport',
]);

/** Redact PII values inside a contact's custom_fields jsonb (non-PII keys untouched). */
export function maskContactFields<T extends Record<string, unknown> | null | undefined>(fields: T): T {
  if (!fields || typeof fields !== 'object') return fields;
  const out = { ...fields } as Record<string, unknown>;
  for (const k of Object.keys(out)) {
    const v = out[k];
    if (CRM_PII_FIELD_KEYS.has(k.toLowerCase()) && v != null && String(v).trim() !== '') {
      out[k] = maskPii(String(v));
    }
  }
  return out as T;
}
