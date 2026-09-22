import { identityDocDigits } from '$lib/components/crm/party-picker';

export function docFromQuery(query: string | null | undefined): string {
  return identityDocDigits(query);
}

export function canAutofillPeruvianDni(type: string, docType: string, doc: string): boolean {
  return type === 'person' && docType === 'DNI' && /^\d{8}$/.test(doc);
}

export function shouldApplyDniLookup(
  requestedDni: string,
  current: { type: string; docType: string; docNumber: string },
): boolean {
  return (
    requestedDni === current.docNumber &&
    canAutofillPeruvianDni(current.type, current.docType, current.docNumber)
  );
}
