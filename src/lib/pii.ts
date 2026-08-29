import { ICP_CLAIM_KEY, ICP_KEY, maskIcpResult } from './components/crm/crm-icp';

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

/** Redact PII values inside a contact's custom_fields jsonb (non-PII keys untouched). */
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
  // `_icp` (ICP fit verdict, spec 2026-08-03 §7) is NOT stripped wholesale like
  // `_relationship`: its `score`/`band` are derived aggregates of the same class
  // as the RFM `score` a masked principal already sees. What must not survive is
  // the LLM-written free text about private conversations — `reasons`,
  // `criteria[].note` and `evidenceRefs` — which `maskIcpResult` (a whitelist,
  // because the masking here is SHALLOW and would never reach a nested field)
  // removes. A malformed blob masks to `undefined` and is dropped outright.
  if (ICP_KEY in out) {
    const masked = maskIcpResult(out[ICP_KEY]);
    if (masked === undefined) delete out[ICP_KEY];
    else out[ICP_KEY] = masked;
  }
  // `_icpClaim` is `_relationshipClaim`'s twin for the ICP inference kernel —
  // same belt-and-braces strip, same unconditional strip below.
  delete out[ICP_CLAIM_KEY];
  return out as T;
}

/** Internal AI-inference lease locks (`{ token, untilEpoch }`). Operational
 *  state for the relationship + ICP kernels, never user-facing data — stripped
 *  for EVERY principal, masked or not, on every serialization path. */
const INTERNAL_CLAIM_KEYS = ['_relationshipClaim', ICP_CLAIM_KEY] as const;

/**
 * The ONE gate every contact-serialization path (roster, detail, hygiene
 * scans, PATCH responses) must run a contact's `custom_fields` through before
 * it reaches the wire. The inference lease locks
 * (`_relationshipClaim`/`_icpClaim`) are stripped for EVERY principal, masked
 * or not. `_relationship` additionally never reaches a masked principal,
 * `_icp` loses its free text there, and PII values get redacted — all three
 * via `maskContactFields`.
 */
export function sanitizeContactFields<T extends Record<string, unknown> | null | undefined>(
  fields: T,
  maskSensitive: boolean,
): T {
  if (!fields || typeof fields !== 'object') return fields;
  if (maskSensitive) return maskContactFields(fields);
  if (!INTERNAL_CLAIM_KEYS.some((k) => k in fields)) return fields;
  const out = { ...fields } as Record<string, unknown>;
  for (const k of INTERNAL_CLAIM_KEYS) delete out[k];
  return out as T;
}
