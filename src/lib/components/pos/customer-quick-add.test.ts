import { describe, expect, it } from 'vitest';
import { dniFromQuery } from './CustomerQuickAdd.svelte';

/**
 * §32.1 — the picker's browse search now seeds its create tab
 * (`PickerCreateContext.query`). The seed must only fire for something that
 * really is a DNI: the same search box also matches names, emails and phones.
 */
describe('dniFromQuery', () => {
  it('seeds an exact 8-digit DNI', () => {
    expect(dniFromQuery('60525600')).toBe('60525600');
  });

  it('strips the noise around a typed DNI', () => {
    expect(dniFromQuery(' DNI 60525600 ')).toBe('60525600');
  });

  it('seeds nothing from a name, an email or an empty box', () => {
    expect(dniFromQuery('ana quispe')).toBe('');
    expect(dniFromQuery('ana@clinic.pe')).toBe('');
    expect(dniFromQuery('')).toBe('');
    expect(dniFromQuery(null)).toBe('');
  });

  it('seeds nothing from a number that is not DNI-shaped', () => {
    expect(dniFromQuery('992376833')).toBe(''); // a phone, 9 digits
    expect(dniFromQuery('6052560')).toBe(''); // 7 digits
    expect(dniFromQuery('20512345678')).toBe(''); // a RUC
  });
});
