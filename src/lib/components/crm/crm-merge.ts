/** Shared types + apply logic for the CRM contact merge / conflict resolver. */

/** One channel identity a contact holds (phone / handle). Multiple per channel allowed. */
export type MergeIdentity = { channel: string; value: string };

/** A candidate column in the merge resolver. */
export type MergeContact = {
  id: string;
  name: string;
  subtitle?: string;
  /** Message count — the most-active included candidate becomes the history anchor (survivor). */
  messages?: number;
  /** Channel identities — all UNION onto the merged record server-side (display-only here). */
  identities?: MergeIdentity[];
};

/** The resolver's decision: which record anchors history, which fold in, and per-field picks. */
export type MergeResolution = {
  survivorId: string;
  loserIds: string[];
  resolved: Record<string, string>;
};

/** One resolvable field: its per-contact values (empty values omitted). The
 *  `key` doubles as the write target — `display_name` → the name column,
 *  `phone` → the phone field, anything else → a `custom_fields` key. */
export type MergeField = {
  key: string;
  label: string;
  values: { contactId: string; value: string }[];
};

/**
 * Merge the losers into the survivor and apply the conflict-resolver choices in
 * ONE server call — the endpoint jsonb-merges the overrides onto the survivor
 * (never a wholesale custom_fields replace, so untouched keys survive). `resolved`
 * maps a MergeField.key → chosen value; `display_name` sets the name, every other
 * key is a `custom_fields` entry.
 */
export async function applyContactMerge(
  survivorId: string,
  loserIds: string[],
  resolved: Record<string, string>,
): Promise<void> {
  const overrides: { displayName?: string; customFields?: Record<string, unknown> } = {};
  const cf: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(resolved)) {
    if (key === 'display_name') overrides.displayName = value;
    else cf[key] = value;
  }
  if (Object.keys(cf).length) overrides.customFields = cf;

  let res: Response;
  try {
    res = await fetch('/api/crm/cleanup/duplicates', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        survivorId,
        loserIds,
        overrides: Object.keys(overrides).length ? overrides : undefined,
      }),
    });
  } catch {
    throw new CrmMergeOutcomeUnknownError();
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* a malformed body is handled below */
  }
  if (
    res.ok &&
    !res.redirected &&
    isRecord(body) &&
    body.ok === true &&
    Object.keys(body).length === 1
  )
    return;
  if (res.status === 403 && isRecord(body) && body.message === 'sensitive_fields_restricted')
    throw new CrmMergeSensitiveFieldsRestrictedError();
  // Anything else may still have committed: never treat it as "nothing happened".
  throw new CrmMergeOutcomeUnknownError();
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** The server refused: the principal may not write masked fields. Nothing changed. */
export class CrmMergeSensitiveFieldsRestrictedError extends Error {
  constructor() {
    super('merge refused: sensitive fields restricted');
  }
}
/** Transport loss, malformed acknowledgement or any other status: the merge may have committed. */
export class CrmMergeOutcomeUnknownError extends Error {
  constructor() {
    super('merge outcome unknown');
  }
}
export const isCrmMergeSensitiveFieldsRestricted = (e: unknown) =>
  e instanceof CrmMergeSensitiveFieldsRestrictedError;

/** Merge feedback state of a host (see specs/129 contracts/client-compatibility.md). */
export type MergePhase =
  | 'idle'
  | 'submitting'
  | 'definite_refusal'
  | 'unknown'
  | 'refreshing'
  | 'refresh_failed'
  | 'selection_required'
  | 'acknowledged_refresh_failed';
/** Phases in which a new explicit Confirm may send a POST. */
export const MERGE_CONFIRMABLE: ReadonlySet<MergePhase> = new Set([
  'idle',
  'selection_required',
  'definite_refusal',
]);

/** Fresh (uncached, no-store) duplicate groups; the caller replaces its rows only on resolve. */
export async function fetchFreshMergeGroups<T = unknown>(): Promise<T[]> {
  const res = await fetch('/api/crm/cleanup/duplicates', {
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
  const body: unknown = res.ok && !res.redirected ? await res.json().catch(() => null) : null;
  if (!isRecord(body) || !Array.isArray(body.groups)) throw new Error('fresh read failed');
  return body.groups as T[];
}
