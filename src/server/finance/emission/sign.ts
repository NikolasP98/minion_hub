import { SignedXml } from 'xml-crypto';

/**
 * SUNAT's documented default is RSA-SHA1. Verified live against the beta
 * sandbox 2026-08-14: SHA1 was accepted (ResponseCode 0) — see PR description.
 * Flip to sha256 here if a future SUNAT beta cutover starts rejecting sha1.
 */
const DIGEST_ALGORITHM = 'http://www.w3.org/2000/09/xmldsig#sha1';
const SIGNATURE_ALGORITHM = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';

/**
 * Enveloped XML-DSig over the whole `Invoice` document, placed inside
 * `ext:UBLExtensions/ext:UBLExtension/ext:ExtensionContent` with Id="SignatureSP"
 * (the Id `cac:Signature/cac:DigitalSignatureAttachment` in ubl.ts points at via
 * `#SignatureSP`). Canonicalization/signing is xml-crypto's job — never hand-roll C14N.
 */
export function signXml(xml: string, key: string, cert: string): string {
  const sig = new SignedXml({
    privateKey: key,
    publicCert: cert,
    signatureAlgorithm: SIGNATURE_ALGORITHM,
    canonicalizationAlgorithm: C14N,
  });
  sig.addReference({
    xpath: '/*',
    isEmptyUri: true,
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', C14N],
    digestAlgorithm: DIGEST_ALGORITHM,
  });
  sig.computeSignature(xml, {
    prefix: 'ds',
    attrs: { Id: 'SignatureSP' },
    location: { reference: "//*[local-name(.)='ExtensionContent']", action: 'append' },
  });
  return sig.getSignedXml();
}
