import { describe, it, expect } from 'vitest';
import {
  normalizeWhitespace,
  isEmailAsName,
  titleCaseName,
  proposeName,
  nameKey,
} from './crm-standardize';

describe('normalizeWhitespace', () => {
  it('trims and collapses', () => {
    expect(normalizeWhitespace('  vale   gonz  ')).toBe('vale gonz');
  });
});

describe('isEmailAsName', () => {
  it('detects emails', () => {
    expect(isEmailAsName('ana@gmail.com')).toBe(true);
    expect(isEmailAsName('Ana Lopez')).toBe(false);
  });
});

describe('titleCaseName', () => {
  it('title-cases simple names', () => {
    expect(titleCaseName('vale gonz')).toBe('Vale Gonz');
    expect(titleCaseName('valeria lucero gordillo cruz')).toBe('Valeria Lucero Gordillo Cruz');
  });
  it('keeps Spanish particles lowercase mid-name but caps the first word', () => {
    expect(titleCaseName('valeria DE LA CRUZ quintana')).toBe('Valeria de la Cruz Quintana');
    expect(titleCaseName('de la cruz')).toBe('De la Cruz'); // first word caps
  });
  it('handles ALL CAPS and accents', () => {
    expect(titleCaseName('JESÚS BERNALES')).toBe('Jesús Bernales');
  });
  it('caps hyphenated parts', () => {
    expect(titleCaseName('ana-maria')).toBe('Ana-Maria');
  });
});

describe('proposeName', () => {
  it('clean name → no issues, unchanged', () => {
    const p = proposeName('Ana Lopez');
    expect(p.proposed).toBe('Ana Lopez');
    expect(p.issues).toEqual([]);
    expect(p.needsReview).toBe(false);
  });
  it('lowercase → title-case, lowercase issue, no review needed', () => {
    const p = proposeName('vale gonz');
    expect(p.proposed).toBe('Vale Gonz');
    expect(p.issues).toContain('lowercase');
    expect(p.needsReview).toBe(false);
  });
  it('whitespace issue', () => {
    expect(proposeName('  Ana   Lopez ').issues).toContain('whitespace');
  });
  it('email-as-name → guess from local-part + needs review', () => {
    const p = proposeName('jhosselin.santillan@gmail.com');
    expect(p.issues).toEqual(['email_as_name']);
    expect(p.needsReview).toBe(true);
    expect(p.proposed).toBe('Jhosselin Santillan');
  });
  it('empty → needs review, null proposed', () => {
    const p = proposeName('   ');
    expect(p.issues).toEqual(['empty']);
    expect(p.proposed).toBeNull();
    expect(p.needsReview).toBe(true);
  });
  it('over-long junk → flagged too_long + review', () => {
    const p = proposeName('Todos nuestros procedimientos son realizados exclusivamente por la Dra. Milagros Toribio Villalobos');
    expect(p.issues).toContain('too_long');
    expect(p.needsReview).toBe(true);
  });
});

describe('nameKey (dup detection)', () => {
  it('strips accents, case, spacing', () => {
    expect(nameKey('  Jesús   BERNALES ')).toBe('jesus bernales');
    expect(nameKey('Jesus Bernales')).toBe(nameKey('Jesús Bernales'));
  });
});
