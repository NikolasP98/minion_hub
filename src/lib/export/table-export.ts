/**
 * Client-side table export — CSV and XLSX — with zero dependencies.
 *
 * CSV is trivial. XLSX is a real (minimal) OOXML spreadsheet: a "stored"
 * (uncompressed) ZIP of the five XML parts Excel/Sheets/LibreOffice require.
 * We hand-roll the ZIP (local headers + central directory + EOCD + CRC32) so we
 * don't pull in SheetJS just to dump a flat table.
 *
 * ponytail: stored (no DEFLATE) — fine for a few-thousand-row CRM export; add
 * compression only if export size becomes a real problem.
 */

export type Rows = (string | number)[][];

const cell = (v: string | number) => (typeof v === 'number' ? String(v) : v ?? '');

// ── CSV ──────────────────────────────────────────────────────────────────────
export function toCsv(rows: Rows): string {
  const esc = (v: string | number) => {
    const s = cell(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

// ── XLSX (minimal OOXML) ───────────────────────────────────────────────────────
const xmlEsc = (v: string | number) =>
  cell(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function colLetter(n: number): string {
  let s = '';
  n += 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sheetXml(rows: Rows): string {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((v, c) => {
          const s = cell(v);
          if (s === '') return '';
          const ref = `${colLetter(c)}${r + 1}`;
          const num = typeof v === 'number' || (s !== '' && !isNaN(Number(s)) && /^-?\d/.test(s));
          return num
            ? `<c r="${ref}"><v>${xmlEsc(s)}</v></c>`
            : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(s)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Export" sheetId="1" r:id="rId1"/></sheets></workbook>`;
const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Build a stored (uncompressed) ZIP from named byte entries. */
function zip(entries: { name: string; data: Uint8Array }[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const enc = new TextEncoder();
  const u16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const crc = crc32(e.data);
    const local = Uint8Array.from([
      0x50, 0x4b, 0x03, 0x04, ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(e.data.length), ...u32(e.data.length), ...u16(nameBytes.length), ...u16(0),
      ...nameBytes,
    ]);
    chunks.push(local, e.data);
    central.push(
      Uint8Array.from([
        0x50, 0x4b, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
        ...u32(crc), ...u32(e.data.length), ...u32(e.data.length), ...u16(nameBytes.length),
        ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameBytes,
      ]),
    );
    offset += local.length + e.data.length;
  }
  const centralSize = central.reduce((a, c) => a + c.length, 0);
  const eocd = Uint8Array.from([
    0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length),
    ...u32(centralSize), ...u32(offset), ...u16(0),
  ]);
  const all = [...chunks, ...central, eocd];
  const total = all.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

export function toXlsx(rows: Rows): Uint8Array {
  const enc = new TextEncoder();
  return zip([
    { name: '[Content_Types].xml', data: enc.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', data: enc.encode(ROOT_RELS) },
    { name: 'xl/workbook.xml', data: enc.encode(WORKBOOK) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(WORKBOOK_RELS) },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheetXml(rows)) },
  ]);
}

// ── Download triggers (browser only) ───────────────────────────────────────────
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadCsv(filename: string, rows: Rows) {
  // BOM so Excel reads UTF-8 (accents in es-PE names) correctly.
  download(new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' }), filename);
}

export function downloadXlsx(filename: string, rows: Rows) {
  const bytes = toXlsx(rows);
  download(
    new Blob([bytes.buffer as ArrayBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename,
  );
}
