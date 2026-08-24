import { describe, expect, it } from 'vitest';
import { creatablePartyTypes, partyPickerSearchParams } from './party-picker';

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
