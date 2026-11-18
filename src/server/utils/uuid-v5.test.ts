import { describe, expect, it } from 'vitest';
import { uuidv5 } from './uuid-v5';
import { uuidv5 as seedUuidv5, matrixUuid } from '../../../scripts/qa/seed/ids';

const DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

describe('uuidv5', () => {
  it('matches the RFC 4122 DNS vector', () => {
    expect(uuidv5('www.example.com', DNS)).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });
  it('sets version 5 and the RFC variant', () => {
    const id = uuidv5('x', DNS);
    expect(id[14]).toBe('5');
    expect('89ab').toContain(id[19]);
  });
  it('requires a canonical namespace', () => {
    expect(() => uuidv5('x', 'nope')).toThrow(/namespace/);
  });
  it('keeps the seed wrapper default-namespace compatible', () => {
    expect(seedUuidv5('a', DNS)).toBe(uuidv5('a', DNS));
    expect(matrixUuid('pos.ticket.voided')).toBe(seedUuidv5('pos.ticket.voided'));
  });
});
