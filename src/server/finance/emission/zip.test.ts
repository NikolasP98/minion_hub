import { describe, expect, it } from 'vitest';
import { emissionFileBaseName, unzipToText, zipInvoiceXml } from './zip';

describe('emissionFileBaseName', () => {
  it('follows SUNAT file naming law: RUC-docType-SERIE-CORRELATIVO', () => {
    expect(emissionFileBaseName('20611172967', '03', 'B999', '1')).toBe('20611172967-03-B999-1');
  });
});

describe('zipInvoiceXml / unzipToText', () => {
  it('round-trips the XML under {fileBaseName}.xml inside {fileBaseName}.zip', () => {
    const base = emissionFileBaseName('20611172967', '01', 'F999', '1');
    const xml = '<Invoice>hello</Invoice>';
    const zipped = zipInvoiceXml(base, xml);
    const files = unzipToText(zipped);
    expect(Object.keys(files)).toEqual([`${base}.xml`]);
    expect(files[`${base}.xml`]).toBe(xml);
  });
});
