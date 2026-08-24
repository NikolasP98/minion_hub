import { describe, expect, it } from 'vitest';
import { creatablePartyTypes } from './party-picker';

describe('PartyPicker create policy', () => {
  it('limits quick creation to party types accepted by the API', () => {
    expect(creatablePartyTypes(undefined)).toEqual(['person', 'company']);
    expect(creatablePartyTypes('person,agent')).toEqual(['person']);
    expect(creatablePartyTypes('agent')).toEqual([]);
  });
});
