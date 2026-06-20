import { describe, it, expect } from 'vitest';
import {
  normalizeWhitespace,
  isEmailAsName,
  titleCaseName,
  proposeName,
  nameKey,
  isUnnamed,
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
  it('strips emoji, keeps the name', () => {
    const p = proposeName('😎Yuri');
    expect(p.proposed).toBe('Yuri');
    expect(p.issues).toContain('emoji');
    expect(p.needsReview).toBe(false);
  });
  it('pure-emoji name → empty + review', () => {
    const p = proposeName('😎🙏🏾');
    expect(p.issues).toContain('empty');
    expect(p.proposed).toBeNull();
    expect(p.needsReview).toBe(true);
  });
  it('unwraps bracketed names', () => {
    const p = proposeName('(Joan Rojas)');
    expect(p.proposed).toBe('Joan Rojas');
    expect(p.issues).toContain('wrapped');
  });
  it('splits camelCase run-togethers, preserving acronyms', () => {
    expect(proposeName('MelissaBastosM').proposed).toBe('Melissa Bastos M');
    const qr = proposeName('PattyQR');
    expect(qr.proposed).toBe('Patty QR');
    expect(qr.issues).toContain('spacing');
    expect(qr.needsReview).toBe(false);
  });
  it('flags lowercase run-together blobs for AI', () => {
    const p = proposeName('fresiamurguiavilchez');
    expect(p.issues).toContain('spacing');
    expect(p.needsReview).toBe(true);
  });
  it('flags leetspeak / foreign glyphs / digits as symbols', () => {
    expect(proposeName('Miigu£l').issues).toContain('symbols');
    expect(proposeName('Ęţşøņ').issues).toContain('symbols');
    expect(proposeName('Mateoarriola065').issues).toContain('symbols');
    expect(proposeName('Miigu£l').needsReview).toBe(true);
  });
  it('strips vanity symbols to a clean baseline', () => {
    expect(proposeName('~~Gabi~~').proposed).toBe('Gabi');
    expect(proposeName('Shioko<3').proposed).toBe('Shioko');
    expect(proposeName('~elsa').proposed).toBe('Elsa');
  });
  it('confidence: clean casing fix outranks an ambiguous flag', () => {
    expect(proposeName('valenissa').confidence).toBeGreaterThan(proposeName('Miigu£l').confidence);
  });
});

describe('isUnnamed (routes to manual section)', () => {
  it('true for blank / single-char / punctuation / emoji-only', () => {
    expect(isUnnamed('')).toBe(true);
    expect(isUnnamed('  ')).toBe(true);
    expect(isUnnamed('.')).toBe(true);
    expect(isUnnamed('J')).toBe(true);
    expect(isUnnamed('😎🙏')).toBe(true);
  });
  it('false for real names (≥2 alphanumerics)', () => {
    expect(isUnnamed('Ana')).toBe(false);
    expect(isUnnamed('Jo')).toBe(false);
  });
});

describe('nameKey (dup detection)', () => {
  it('strips accents, case, spacing', () => {
    expect(nameKey('  Jesús   BERNALES ')).toBe('jesus bernales');
    expect(nameKey('Jesus Bernales')).toBe(nameKey('Jesús Bernales'));
  });
});
