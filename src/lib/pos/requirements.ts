/**
 * Per-org ticket requirements — what the customer on a ticket must carry
 * before the till may charge it. ONE registry, read by the settings page
 * (one selector per kind), the till (charge blocker + customer card) and
 * `submitTicket` (the authority: a 400 with the kind's error code).
 *
 * Adding a requirement = one entry in `REQUIREMENT_KINDS` + the customer
 * field it reads + its i18n strings. Absent/unknown level = `'off'`, never a
 * silent block. `'optional'` is stored and shown but inert (a future nudge).
 */
export const REQUIREMENT_LEVELS = ['off', 'optional', 'required'] as const;
export type RequirementLevel = (typeof REQUIREMENT_LEVELS)[number];

export const REQUIREMENT_KINDS = ['identityDocument', 'phone'] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

export type PosRequirements = Record<RequirementKind, RequirementLevel>;

/** The customer fields a requirement reads — the party spine's columns. */
export interface RequirementSubject {
  docNumber?: string | null;
  phone?: string | null;
}

/** `submitTicket` error code per kind (the till maps each to its message). */
export const REQUIREMENT_ERROR_CODE: Record<RequirementKind, string> = {
  identityDocument: 'identity_document_required',
  phone: 'phone_required',
};

export function isRequirementLevel(v: unknown): v is RequirementLevel {
  return (REQUIREMENT_LEVELS as readonly unknown[]).includes(v);
}

/** A row written before a kind existed (or by hand) lacks its key — reads as off. */
export function normalizeRequirements(raw: unknown): PosRequirements {
  const r = (raw ?? {}) as Partial<Record<RequirementKind, unknown>>;
  return Object.fromEntries(
    REQUIREMENT_KINDS.map((k) => [k, isRequirementLevel(r[k]) ? r[k] : 'off']),
  ) as PosRequirements;
}

function present(kind: RequirementKind, subject: RequirementSubject): boolean {
  switch (kind) {
    case 'identityDocument':
      return Boolean(subject.docNumber);
    case 'phone':
      return Boolean(subject.phone);
  }
}

/** The `'required'` kinds this customer does not satisfy, in registry order. */
export function missingRequirements(
  requirements: Partial<PosRequirements> | null | undefined,
  subject: RequirementSubject,
): RequirementKind[] {
  return REQUIREMENT_KINDS.filter((k) => requirements?.[k] === 'required' && !present(k, subject));
}
