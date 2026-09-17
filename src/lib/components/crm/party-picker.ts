export type CreatablePartyType = 'person' | 'company';

/** Peruvian identity documents by shape: DNI = 8 digits, RUC = 11 digits. */
export type IdentityDocKind = 'dni' | 'ruc';

/**
 * Classify a typed document number. Non-digits are stripped first so
 * "RUC 20512345678" still classifies; anything that is not exactly 8 or 11
 * digits is not an identity document (a 9-digit phone, a 7-digit typo, a name).
 */
export function classifyIdentityDoc(input: string | null | undefined): IdentityDocKind | null {
  const digits = (input ?? '').replace(/\D/g, '');
  return digits.length === 8 ? 'dni' : digits.length === 11 ? 'ruc' : null;
}

/** The digits of a DNI/RUC-shaped input, or '' when it is not one. */
export function identityDocDigits(input: string | null | undefined): string {
  return classifyIdentityDoc(input) ? (input ?? '').replace(/\D/g, '') : '';
}

export interface PartyOption {
  id: string;
  name: string | null;
  type: string;
  email: string | null;
  docNumber: string | null;
  phone9?: string | null;
  /** Identity confirmed against the PERUDEVS DNI registry. Optional because
   *  hand-built PartyOption values (e.g. a freshly quick-added party) omit it. */
  dniVerified?: boolean;
}

/**
 * The picker opens on the trusted CRM subset, but a real query searches the
 * complete party spine. Contexts with a different workflow can opt out.
 */
export function partyPickerSearchParams(
  term: string,
  types: string | undefined,
  initialVerifiedOnly?: boolean,
  doc?: IdentityDocKind,
): URLSearchParams {
  const params = new URLSearchParams({ q: term });
  const includesAgents = (types ?? '').split(',').some((type) => type.trim() === 'agent');
  // `verified` means DNI-verified; a RUC-only context (stock entries) would
  // otherwise open on an empty list, so the doc filter replaces it.
  const verifiedOnly = initialVerifiedOnly ?? (!includesAgents && !doc);
  if (types) params.set('type', types);
  if (doc) params.set('doc', doc);
  if (verifiedOnly && !term.trim()) params.set('verified', '1');
  return params;
}

export function creatablePartyTypes(types: string | undefined): CreatablePartyType[] {
  const requested = new Set(
    (types ?? 'person,company')
      .split(',')
      .map((type) => type.trim())
      .filter(Boolean),
  );
  return (['person', 'company'] as const).filter((type) => requested.has(type));
}
