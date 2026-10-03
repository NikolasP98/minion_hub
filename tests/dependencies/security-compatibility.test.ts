// TODO(handoff): Qualify residual advisory families and container/plugin inventories before DEP-01 closure; this fixture covers only the bounded Hub patch. See meta proposals/2026-09-08-platform-qc-remediation.md (UI-06) and .planning/phases/12-dependency-provenance/12-ADVISORIES.md.
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DOMImplementation, DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import { signXml } from '../../src/server/finance/emission/sign';
const require = createRequire(import.meta.url);
describe('bounded dependency security compatibility', () => {
  it('negotiates valid Accept headers and bounds malformed input CPU in an isolated child', () => {
    const module = pathToFileURL(
      join(dirname(require.resolve('@sveltejs/kit/package.json')), 'src/utils/http.js'),
    ).href;
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      const {negotiate}=await import(${JSON.stringify(module)});
      if(negotiate('text/html;q=0.5,application/json;q=1',['text/html','application/json'])!=='application/json')process.exit(2);
      console.log('accept-ready');
      if(negotiate('a'.repeat(100000),['text/html'])!==undefined)process.exit(3);
      console.log('accept-ok');`,
      ],
      { encoding: 'utf8', timeout: 2500 },
    );
    expect(result.stdout.trim().split('\n')[0]).toBe('accept-ready');
    expect(result.error?.message ?? result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('accept-ready\naccept-ok');
  });
  it('bounds malformed Tiptap block/inline Markdown attribute parsing in a child', () => {
    const module = pathToFileURL(require.resolve('@tiptap/core')).href;
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      const {createAtomBlockMarkdownSpec,createInlineMarkdownSpec}=await import(${JSON.stringify(module)});
      console.log('markdown-ready');
      createAtomBlockMarkdownSpec({nodeName:'probe'}).markdownTokenizer.tokenize(':::probe {'+'__QUOTED_0'.repeat(10000)+'__QUOTED_0__} :::\\n',[],{});
      createInlineMarkdownSpec({nodeName:'probe',selfClosing:true}).markdownTokenizer.tokenize('[probe '+'0'.repeat(100000)+']',[],{});
      console.log('markdown-ok');`,
      ],
      { encoding: 'utf8', timeout: 2500 },
    );
    expect(result.stdout.trim().split('\n')[0]).toBe('markdown-ready');
    expect(result.error?.message ?? result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('markdown-ready\nmarkdown-ok');
  });
  it('rejects an invalid entity name during well-formed XML serialization', () => {
    const doc = new DOMImplementation().createDocument(null, 'Invoice', null);
    const entity = (
      doc as typeof doc & { createEntityReference: (name: string) => Node }
    ).createEntityReference('safe');
    Object.assign(entity, { nodeName: 'safe;<Injected/>' });
    doc.documentElement.appendChild(entity);
    expect(() =>
      new XMLSerializer().serializeToString(doc, false, undefined, { requireWellFormed: true }),
    ).toThrow();
  });
  it('signs the real invoice XML path, verifies it and rejects modified invoice content', () => {
    const keys = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const xml =
      '<Invoice xmlns:ext="urn:fixture"><ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent/></ext:UBLExtension></ext:UBLExtensions><Amount>12.00</Amount></Invoice>';
    const signed = signXml(xml, keys.privateKey, keys.publicKey);
    const document = new DOMParser().parseFromString(signed, 'application/xml');
    const signature = document.getElementsByTagName('ds:Signature')[0];
    const verifier = new SignedXml({ publicCert: keys.publicKey, getCertFromKeyInfo: () => null });
    verifier.loadSignature(signature);
    expect(verifier.checkSignature(signed)).toBe(true);
    expect(verifier.checkSignature(signed.replace('12.00', '99.00'))).toBe(false);
  });
});
