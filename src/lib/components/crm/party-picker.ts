export type CreatablePartyType = 'person' | 'company';

export interface PartyOption {
  id: string;
  name: string | null;
  type: string;
  email: string | null;
  docNumber: string | null;
  phone9?: string | null;
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
