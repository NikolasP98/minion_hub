import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parseCdr } from './cdr';

const ACCEPTED_CDR_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ApplicationResponse xmlns="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
<cac:DocumentResponse>
<cac:Response>
<cbc:ResponseCode>0</cbc:ResponseCode>
<cbc:Description>La Boleta numero B999-1, ha sido aceptada</cbc:Description>
</cac:Response>
<cac:DocumentReference>
<cbc:ID>B999-1</cbc:ID>
</cac:DocumentReference>
</cac:DocumentResponse>
</ApplicationResponse>`;

function fixtureZip(entryName: string, xml: string): Uint8Array {
  return zipSync({ [entryName]: strToU8(xml) });
}

describe('parseCdr', () => {
  it('parses ResponseCode and Description from the R-*.xml entry', () => {
    const zip = fixtureZip('R-20611172967-03-B999-1.xml', ACCEPTED_CDR_XML);
    expect(parseCdr(zip)).toEqual({ responseCode: '0', description: 'La Boleta numero B999-1, ha sido aceptada', notes: [] });
  });

  it('throws when the zip has no R-*.xml entry', () => {
    const zip = fixtureZip('unexpected.xml', ACCEPTED_CDR_XML);
    expect(() => parseCdr(zip)).toThrow(/R-\*\.xml/);
  });
});
