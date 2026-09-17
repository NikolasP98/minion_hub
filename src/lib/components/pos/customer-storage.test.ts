import { describe, it, expect } from 'vitest';
import {
  EMPTY_CUSTOMER,
  customerStorageKey,
  parseStoredCustomer,
  serializeCustomer,
} from './customer-storage';

describe('pos customer storage', () => {
  it('round-trips a selected CRM contact and keys per org', () => {
    const c = { partyId: 'p1', customerName: 'Ana', customerPhone: '999', customerDocNumber: null };
    expect(parseStoredCustomer(serializeCustomer(c))).toEqual(c);
    expect(customerStorageKey('org-1')).toBe('pos-customer-org-1');
    expect(customerStorageKey(null)).toBe('pos-customer-default');
  });

  it('serializes an empty customer as a removal and tolerates garbage', () => {
    expect(serializeCustomer(EMPTY_CUSTOMER)).toBeNull();
    expect(parseStoredCustomer(null)).toEqual(EMPTY_CUSTOMER);
    expect(parseStoredCustomer('{not json')).toEqual(EMPTY_CUSTOMER);
    expect(parseStoredCustomer('{"partyId":"","customerName":"  "}')).toEqual(EMPTY_CUSTOMER);
    expect(parseStoredCustomer('{"partyId":42,"customerName":"Ana"}')).toEqual({
      ...EMPTY_CUSTOMER,
      customerName: 'Ana',
    });
  });
});
