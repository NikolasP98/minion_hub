/**
 * UBL markup fragments shared between `ubl.ts` (Invoice) and `summary.ts`
 * (SummaryDocuments/VoidedDocuments) — the extension placeholder and the
 * `cac:Signature` block are byte-identical across all three document types
 * that this library builds.
 */

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Placeholder `ext:UBLExtensions` block — `sign.ts` fills `ext:ExtensionContent`
 * with the XML-DSig `ds:Signature` it computes over the whole document. */
export const EXTENSION_PLACEHOLDER_XML = `<ext:UBLExtensions>
<ext:UBLExtension>
<ext:ExtensionContent/>
</ext:UBLExtension>
</ext:UBLExtensions>`;

/**
 * `cac:Signature` block pointing `DigitalSignatureAttachment` at `#SignatureSP`
 * — the `Id` `sign.ts` gives the `ds:Signature` it appends into
 * `ext:ExtensionContent`. Same shape for Invoice, SummaryDocuments, and
 * VoidedDocuments.
 */
export function signatureBlockXml(ruc: string, razonSocial: string): string {
  return `<cac:Signature>
<cbc:ID>${escapeXml(ruc)}</cbc:ID>
<cac:SignatoryParty>
<cac:PartyIdentification>
<cbc:ID>${escapeXml(ruc)}</cbc:ID>
</cac:PartyIdentification>
<cac:PartyName>
<cbc:Name>${escapeXml(razonSocial)}</cbc:Name>
</cac:PartyName>
</cac:SignatoryParty>
<cac:DigitalSignatureAttachment>
<cac:ExternalReference>
<cbc:URI>#SignatureSP</cbc:URI>
</cac:ExternalReference>
</cac:DigitalSignatureAttachment>
</cac:Signature>`;
}
