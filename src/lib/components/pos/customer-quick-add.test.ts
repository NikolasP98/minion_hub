import { describe, expect, it } from 'vitest';
import { docFromQuery } from './CustomerQuickAdd.svelte';

/**
 * §32.1 — the picker's browse search now seeds its create tab
 * (`PickerCreateContext.query`). The seed must only fire for something that
 * really is a document — a DNI (8 digits) or a RUC (11 digits): the same
 * search box also matches names, emails and phones.
 */
describe('docFromQuery', () => {
  it('seeds an exact 8-digit DNI', () => {
    expect(docFromQuery('60525600')).toBe('60525600');
  });

  it('seeds an exact 11-digit RUC', () => {
    expect(docFromQuery('20512345678')).toBe('20512345678');
  });

  it('strips the noise around a typed document', () => {
    expect(docFromQuery(' DNI 60525600 ')).toBe('60525600');
    expect(docFromQuery('RUC 20512345678')).toBe('20512345678');
  });

  it('seeds nothing from a name, an email or an empty box', () => {
    expect(docFromQuery('ana quispe')).toBe('');
    expect(docFromQuery('ana@clinic.pe')).toBe('');
    expect(docFromQuery('')).toBe('');
    expect(docFromQuery(null)).toBe('');
  });

  it('seeds nothing from a number that is neither DNI- nor RUC-shaped', () => {
    expect(docFromQuery('992376833')).toBe(''); // a phone, 9 digits
    expect(docFromQuery('6052560')).toBe(''); // 7 digits
    expect(docFromQuery('205123456789')).toBe(''); // 12 digits
  });
});
