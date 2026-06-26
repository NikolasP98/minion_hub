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
