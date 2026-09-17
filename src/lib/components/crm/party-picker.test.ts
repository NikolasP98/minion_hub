import { describe, expect, it } from 'vitest';
import {
  classifyIdentityDoc,
  creatablePartyTypes,
  identityDocDigits,
  partyPickerSearchParams,
} from './party-picker';

describe('PartyPicker create policy', () => {
  it('limits quick creation to party types accepted by the API', () => {
    expect(creatablePartyTypes(undefined)).toEqual(['person', 'company']);
    expect(creatablePartyTypes('person,agent')).toEqual(['person']);
    expect(creatablePartyTypes('agent')).toEqual([]);
  });
});

describe('PartyPicker initial results', () => {
  it('requests verified parties for an empty initial query', () => {
    expect(partyPickerSearchParams('', 'person,company').toString()).toBe(
      'q=&type=person%2Ccompany&verified=1',
    );
    expect(partyPickerSearchParams('   ', 'person').get('verified')).toBe('1');
  });

  it('searches all parties once the user enters a term', () => {
    const params = partyPickerSearchParams('eva', 'person');

    expect(params.get('q')).toBe('eva');
    expect(params.get('verified')).toBeNull();
  });

  it('allows a context to opt out of the verified initial filter', () => {
    expect(partyPickerSearchParams('', 'agent', false).get('verified')).toBeNull();
  });

  it('preserves the unfiltered initial list for agent-accepting contexts', () => {
    expect(partyPickerSearchParams('', 'person,agent').get('verified')).toBeNull();
  });
});

describe('classifyIdentityDoc (DNI = 8 digits, RUC = 11 digits)', () => {
  it('classifies by digit count, ignoring surrounding noise', () => {
    expect(classifyIdentityDoc('60525600')).toBe('dni');
    expect(classifyIdentityDoc(' DNI 60525600 ')).toBe('dni');
    expect(classifyIdentityDoc('20512345678')).toBe('ruc');
    expect(classifyIdentityDoc('RUC 20512345678')).toBe('ruc');
  });

  it('rejects anything that is not DNI- or RUC-shaped', () => {
    expect(classifyIdentityDoc('992376833')).toBeNull(); // 9-digit phone
    expect(classifyIdentityDoc('6052560')).toBeNull(); // 7 digits
    expect(classifyIdentityDoc('205123456789')).toBeNull(); // 12 digits
    expect(classifyIdentityDoc('ana quispe')).toBeNull();
    expect(classifyIdentityDoc('')).toBeNull();
    expect(classifyIdentityDoc(null)).toBeNull();
  });

  it('identityDocDigits returns the bare digits only for a classified document', () => {
    expect(identityDocDigits('RUC 20512345678')).toBe('20512345678');
    expect(identityDocDigits('992376833')).toBe('');
  });
});

describe('PartyPicker RUC-only contexts (stock entries counterpart)', () => {
  it('sends the doc filter and drops the DNI-verified initial filter', () => {
    const params = partyPickerSearchParams('', undefined, undefined, 'ruc');
    expect(params.get('doc')).toBe('ruc');
    expect(params.get('verified')).toBeNull();
  });

  it('keeps the doc filter on a typed search', () => {
    expect(partyPickerSearchParams('acme', undefined, undefined, 'ruc').get('doc')).toBe('ruc');
  });
});
