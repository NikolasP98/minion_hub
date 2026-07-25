import { describe, it, expect } from 'vitest';
import {
  CODE_MAX,
  codeError,
  isValidCode,
  normalizeCode,
  suggestCode,
  uniqueCodeFrom,
} from './code';
import { classify, inferLine, inferZone } from './taxonomy';
import { groupBy, isGroupRow, toTreeRows } from './grouping';

describe('catalog code rail', () => {
  it('accepts 2–4 uppercase alphanumerics only', () => {
    expect(isValidCode('LO1')).toBe(true);
    expect(isValidCode('MSVP')).toBe(true);
    expect(isValidCode('AJ')).toBe(true);
    expect(isValidCode('H')).toBe(false); // too short
    expect(isValidCode('RSSVP')).toBe(false); // too long
    expect(isValidCode('CM-SVP')).toBe(false); // separator
    expect(isValidCode('OO1 990')).toBe(false); // space
    expect(isValidCode('lo1')).toBe(false); // not uppercase
  });

  it('reports WHY a code is rejected, so the UI can say it', () => {
    expect(codeError('')).toBe('empty');
    expect(codeError('  ')).toBe('empty');
    expect(codeError('H')).toBe('too_short');
    expect(codeError('RSSVP')).toBe('too_long');
    expect(codeError('CM-SVP')).toBe('charset');
    expect(codeError('FACES 4788')).toBe('charset');
    expect(codeError('MSVP')).toBeNull();
    expect(codeError('msvp')).toBeNull(); // case is normalized, not an error
  });

  it('normalizes pasted junk in place instead of rejecting on submit', () => {
    expect(normalizeCode('CM-SVP')).toBe('CMSV');
    expect(normalizeCode('OO1 990')).toBe('OO19');
    expect(normalizeCode('faces 4788')).toBe('FACE');
    expect(normalizeCode('  lo1 ')).toBe('LO1');
    // Normalization is not validation — a too-short result must still fail.
    expect(codeError(normalizeCode('!'))).toBe('empty');
  });

  it('suggests initials for multi-word names, prefix for single words', () => {
    expect(suggestCode('Malar - Saypha Volume Plus')).toBe('MSVP');
    expect(suggestCode('Lips (Opera I)')).toBe('LOI');
    expect(suggestCode('Eudaria')).toBe('EUDA');
    expect(suggestCode('')).toBe('');
    // Never exceeds the cap even for a long name.
    expect(suggestCode('Contorno Mandibular Saypha Volume Plus Extra').length).toBe(CODE_MAX);
  });

  it('resolves collisions without exceeding the cap', () => {
    expect(uniqueCodeFrom('Malar Saypha Volume Plus', [])).toBe('MSVP');
    expect(uniqueCodeFrom('Malar Saypha Volume Plus', ['MSVP'])).toBe('MSV2');
    expect(uniqueCodeFrom('Malar Saypha Volume Plus', ['MSVP', 'MSV2'])).toBe('MSV3');
    const taken = ['MSVP', ...Array.from({ length: 8 }, (_, i) => `MSV${i + 2}`)];
    const out = uniqueCodeFrom('Malar Saypha Volume Plus', taken);
    expect(out.length).toBeLessThanOrEqual(CODE_MAX);
    expect(isValidCode(out)).toBe(true);
    expect(taken).not.toContain(out);
    // A single-letter stem still clears the 2-char minimum.
    expect(uniqueCodeFrom('A', ['A'])).toBe('A2');
  });
});

describe('catalog taxonomy', () => {
  it('reads the zone out of real catalog names', () => {
    expect(inferZone('Malar - Saypha Volume Plus')).toBe('malar');
    expect(inferZone('Pomulo MIFILL')).toBe('malar'); // pómulo === malar
    expect(inferZone('Botox Ojeras')).toBe('ojeras'); // specific beats the facial tail
    expect(inferZone('Afinamiento Facial')).toBe('rostro');
    expect(inferZone('Botox Full Face')).toBe('rostro');
    expect(inferZone('RinoSculpt MIFILL')).toBe('nariz');
    expect(inferZone('Jawline SAYPHA')).toBe('mandibula');
    expect(inferZone('Contorno Mandibular')).toBe('mandibula');
    expect(inferZone('Lineas de Marioneta')).toBe('marioneta');
    expect(inferZone('Jabon intimo Eudaria')).toBe('intima');
    expect(inferZone('FAJA-G')).toBe('cuerpo');
    expect(inferZone('NCTF-3s', 'NCTF3')).toBe('rostro'); // via code override
    expect(inferZone('Reserva de Consulta', 'RE')).toBe('ninguna');
  });

  it('never collapses a longer line variant into its prefix', () => {
    expect(inferLine('Surcos - Saypha Volume Plus')).toBe('saypha-volume-plus');
    expect(inferLine('Surcos - Saypha Volume')).toBe('saypha-volume');
    expect(inferLine('Saypha Filler Labios')).toBe('saypha-filler');
    expect(inferLine('SURCOS SAYPHA')).toBe('saypha');
    expect(inferLine('Surcos (Opera IV)')).toBe('opera-iv');
    expect(inferLine('Lineas Marioneta (Opera III)')).toBe('opera-iii');
    expect(inferLine('Lips (Opera II)')).toBe('opera-ii');
    expect(inferLine('Lips (Opera I)')).toBe('opera-i');
    expect(inferLine('Lips (Opera)')).toBe('opera');
  });

  it('prefers the mapped insumo over anything parsed from the name', () => {
    // The name says nothing about a line; the stock mapping settles it.
    expect(inferLine('Ojeras Opera', 'OjO', 'HA Opera IV (Caja)')).toBe('opera-iv');
    // And it OVERRIDES a name that disagrees — the insumo actually burned wins.
    expect(inferLine('Lips (Opera I)', 'LO1', 'HA Saypha Volume (Caja)')).toBe('saypha-volume');
    expect(classify('Ojeras Opera', 'OjO', ['HA Opera IV (Caja)']).lineSource).toBe('mapped');
  });

  it('distrusts the mapping when a product burns MORE THAN ONE item', () => {
    // Two mapped items: stk_consumption cannot say which is therapeutic, so the
    // name decides and provenance must NOT claim 'mapped'.
    const many = ['HA Saypha Volume (Caja)', 'Lidocaina (ml)'];
    expect(inferLine('Lips (Opera I)', 'LO1', many)).toBe('opera-i'); // name wins
    expect(classify('Lips (Opera I)', 'LO1', many).lineSource).toBe('inferred');
    // …and with no usable name either, it becomes an audit item, not a guess.
    expect(inferLine('Contorno Mandibular', 'CM', many, 'mandibula')).toBe('por-definir');
  });

  it('models "zone chosen at sale time" separately from "no zone"', () => {
    expect(inferZone('Toxina 1 Zona', 'T1Z')).toBe('variable');
    expect(inferZone('Toxina 2 Zonas', 'T2Z')).toBe('variable');
    expect(inferZone('BOTOX 1 zona', 'FACES 4788')).toBe('variable');
    // A deposit really has no zone.
    expect(inferZone('Reserva de Consulta', 'RE')).toBe('ninguna');
    // A variable-zone toxin still classifies as a Toxina, not a Cargo.
    expect(classify('Toxina 1 Zona', 'T1Z', null).category).toBe('Toxina');
  });

  it('separates "no insumo" from "insumo not yet recorded"', () => {
    // Clinical zone, no line anywhere → an audit item, NOT a fee.
    const cm = classify('Contorno Mandibular', 'CM', null);
    expect(cm.line).toBe('por-definir');
    expect(cm.category).toBe('Por clasificar');

    // No zone and no line → genuinely a charge.
    const re = classify('Reserva de Consulta', 'RE', null);
    expect(re.line).toBe('ninguno');
    expect(re.category).toBe('Cargo');
  });

  it('does not guess a line from a price band', () => {
    // LABIOS DEEP (800) sits next to Lips Sculpt MIFILL (790). Not evidence.
    expect(classify('LABIOS DEEP', 'LDP', null).line).toBe('por-definir');
    // Afinamiento could be deoxycholic acid or masseter toxin; stays unknown.
    expect(classify('Afinamiento de Rostro', 'AF1', null).line).toBe('por-definir');
  });

  it('makes a bundle its own category regardless of what its children use', () => {
    expect(classify('Dúo MIFILL', 'D01', null, true).category).toBe('Paquete');
    expect(classify('Dúo MIFILL', 'D01', null, false).category).toBe('Relleno');
  });
});

// ── grouping ───────────────────────────────────────────────────────────────
describe('catalog grouping', () => {
  const row = (productId: string, name: string, code = 'XX') => ({
    productId,
    name,
    code,
    // Present so the assertions below can check toTreeRows blanks them on the
    // synthetic header (a real SellableRow always has these).
    unitPrice: 100 as number | null,
    stockQty: 5 as number | null,
    category: 'x' as string | null,
    taxonomy: classify(name, code, null),
  });

  it('buckets in canonical axis order and drops empty groups', () => {
    const rows = [
      row('1', 'Mentón MIFILL'),
      row('2', 'Lips Sculpt MIFILL'),
      row('3', 'Ojeras MIFILL'),
      row('4', 'Lip Sculpt - Saypha Volume'),
    ];
    const groups = groupBy(rows, 'zone');
    // ZONE_ORDER is labios, ojeras, nariz, menton, … — not insertion order.
    expect(groups.map((g) => g.key)).toEqual(['labios', 'ojeras', 'menton']);
    expect(groups[0].rows).toHaveLength(2); // both lip products
    // 17 zones exist but only 3 are populated; the rest must not appear.
    expect(groups).toHaveLength(3);
  });

  it('groups the same rows differently per axis', () => {
    const rows = [row('1', 'Mentón MIFILL'), row('2', 'Menton - Saypha Volume Plus')];
    expect(groupBy(rows, 'zone').map((g) => g.key)).toEqual(['menton']);
    expect(groupBy(rows, 'line').map((g) => g.key)).toEqual(['saypha-volume-plus', 'mifill']);
    expect(groupBy(rows, 'none')).toHaveLength(1);
  });

  it('marks synthetic group rows so they can never be sold', () => {
    const rows = [row('1', 'Mentón MIFILL'), row('2', 'Lips Sculpt MIFILL')];
    const tree = toTreeRows(rows, 'zone');

    expect(tree).toHaveLength(2);
    for (const parent of tree) {
      expect(isGroupRow(parent)).toBe(true);
      // A header must not look like something with a price or stock.
      expect(parent.unitPrice).toBeNull();
      expect(parent.stockQty).toBeNull();
      expect(parent.code).toBe('');
      // Namespaced id — must not collide with a real productId.
      expect(parent.productId.startsWith('__group:')).toBe(true);
    }
    const children = tree.flatMap((p) => p.__children ?? []);
    expect(children.map((c) => c.productId).sort()).toEqual(['1', '2']);
    for (const child of children) expect(isGroupRow(child)).toBe(false);
  });

  it("axis 'none' passes rows through untouched, so nothing is a group row", () => {
    const rows = [row('1', 'Mentón MIFILL')];
    const tree = toTreeRows(rows, 'none');
    expect(tree).toEqual(rows);
    expect(isGroupRow(tree[0])).toBe(false);
  });
});

// Regression: the 2026-07-25 recode renamed several codes (JB→SENS, H→HIAL,
// NCTF3→NCTF, F-G→FAJG). The code-keyed overrides had to follow, or those
// products silently fell through to 'Cargo'/'Sin zona'.
describe('taxonomy survives the 2026-07-25 recode', () => {
  it('classifies the renamed codes, and still honours the retired ones', () => {
    expect(classify('Sensiclean', 'SENS', null).category).toBe('Cosmético');
    expect(classify('Sensiclean', 'JB', null).category).toBe('Cosmético'); // old code = live alias
    expect(classify('Hialuronidasa', 'HIAL', null).line).toBe('hialuronidasa');
    expect(classify('NCTF-3s', 'NCTF', null).category).toBe('Mesoterapia');
    expect(classify('Faja G', 'FAJG', null).category).toBe('Prenda');
    expect(classify('Faja S', 'FAJS', null).category).toBe('Prenda');
  });
});
