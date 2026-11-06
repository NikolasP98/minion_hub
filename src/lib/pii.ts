import { ICP_CLAIM_KEY, ICP_KEY, maskIcpResult } from '$lib/components/crm/crm-icp';

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
  'telefono',
  'phone',
  'celular',
  'movil',
  'whatsapp',
  'tel',
  'email',
  'correo',
  'mail',
  'dni',
  'documento',
  'document',
  'doc',
  'cedula',
  'ruc',
  'pasaporte',
  'passport',
]);

/**
 * Redact PII values inside a contact's custom_fields jsonb (non-PII keys
 * untouched). Also strips `_relationship` and the lease locks
 * (`_relationshipClaim`, `_icpClaim`), and replaces `_icp` with its masked
 * projection (`maskIcpResult`: score, band, criteria id/met, icpVersion,
 * scoredAt — never reasons, notes or evidence). Never mutates the input.
 */
export function maskContactFields<T extends Record<string, unknown> | null | undefined>(
  fields: T,
): T {
  if (!fields || typeof fields !== 'object') return fields;
  const out = { ...fields } as Record<string, unknown>;
  for (const k of Object.keys(out)) {
    const v = out[k];
    if (CRM_PII_FIELD_KEYS.has(k.toLowerCase()) && v != null && String(v).trim() !== '') {
      out[k] = maskPii(String(v));
    }
  }
  // `_relationship` (CRM relationship graph, spec R6) may carry AI-inferred
  // evidence about a contact's real-world relationships — strip the WHOLE
  // object for a masked principal, unlike `_funnel` (a stage id, not
  // sensitive) which passes through untouched below.
  delete out['_relationship'];
  // `_relationshipClaim` is an internal AI-inference lease lock (token +
  // expiry) — never user-facing data, so it's stripped here too (belt and
  // braces; `sanitizeContactFields` below also strips it unconditionally,
  // including for an UNMASKED caller, which this function alone can't cover).
  delete out['_relationshipClaim'];
  // `_icpClaim` is the same kind of lease lock for the ICP scorer.
  delete out[ICP_CLAIM_KEY];
  // `_icp` (per-contact ICP result) carries AI-written free text (reasons,
  // criteria notes) and evidence chunk ids. Spec §7 default ruling: a masked
  // principal keeps score/band/criteria{id,met}; everything else is dropped.
  // Malformed input fails closed (key removed).
  // TODO(handoff): the stricter spec §7 fallback — delete `_icp` entirely, like
  // `_relationship` above — is a reviewer decision; swap the branch below for
  // `delete out[ICP_KEY]` if they choose it.
  if (ICP_KEY in out) {
    const masked = maskIcpResult(out[ICP_KEY]);
    if (masked) out[ICP_KEY] = masked;
    else delete out[ICP_KEY];
  }
  return out as T;
}

/**
 * The ONE gate every contact-serialization path (roster, detail, hygiene
 * scans, PATCH responses) must run a contact's `custom_fields` through before
 * it reaches the wire. `_relationshipClaim` and `_icpClaim` (AI lease locks —
 * operational state, never user-facing) are stripped for EVERY principal,
 * masked or not; an unmasked principal keeps `_icp` as stored.
 * `_relationship` additionally never reaches a masked principal, `_icp` is
 * reduced to its masked projection, and PII values get redacted — all via
 * `maskContactFields`.
 */
export function sanitizeContactFields<T extends Record<string, unknown> | null | undefined>(
  fields: T,
  maskSensitive: boolean,
): T {
  if (!fields || typeof fields !== 'object') return fields;
  if (maskSensitive) return maskContactFields(fields);
  if (!('_relationshipClaim' in fields) && !(ICP_CLAIM_KEY in fields)) return fields;
  const out = { ...fields } as Record<string, unknown>;
  delete out['_relationshipClaim'];
  delete out[ICP_CLAIM_KEY];
  return out as T;
}
