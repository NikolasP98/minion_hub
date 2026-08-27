export type CreatablePartyType = 'person' | 'company';

export interface PartyOption {
  id: string;
  name: string | null;
  type: string;
  email: string | null;
  docNumber: string | null;
  phone9?: string | null;
}

/**
 * The picker opens on the trusted CRM subset, but a real query searches the
 * complete party spine. Contexts with a different workflow can opt out.
 */
export function partyPickerSearchParams(
  term: string,
  types: string | undefined,
  initialVerifiedOnly?: boolean,
): URLSearchParams {
  const params = new URLSearchParams({ q: term });
  const includesAgents = (types ?? '').split(',').some((type) => type.trim() === 'agent');
  const verifiedOnly = initialVerifiedOnly ?? !includesAgents;
  if (types) params.set('type', types);
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
