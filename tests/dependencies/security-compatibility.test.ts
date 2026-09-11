// TODO(handoff): Qualify residual advisory families and container/plugin inventories before DEP-01 closure; this fixture covers only the bounded Hub patch. See meta proposals/2026-09-08-platform-qc-remediation.md (UI-06) and .planning/phases/12-dependency-provenance/12-ADVISORIES.md.
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
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

// Chromium is required for browser security qualification. Ordinary unit runs
// do not acquire a shared browser. The explicit gate fails if requested but
// unavailable; omitted native qualification remains an open release gate.
it.runIf(process.env.MINION_DEPENDENCY_BROWSER === '1')(
  'native editor/paste and sanitizer security',
  async () => {
    const cdpUrl = process.env.BU_CDP_URL ?? 'http://127.0.0.1:9223';
    if (cdpUrl !== 'http://127.0.0.1:9223')
      throw new Error('This local fixture requires the dedicated headless CDP9223 session');
    // Fail before invoking the harness if the dedicated browser is unavailable;
    // never let automatic setup fall back to an interactive user browser.
    const browser = await fetch(cdpUrl + '/json/version', { signal: AbortSignal.timeout(2000) });
    if (!browser.ok) throw new Error('Dedicated headless browser is unavailable');
    const base = join(process.cwd(), 'node_modules', '.cache');
    await mkdir(base, { recursive: true });
    const dir = await mkdtemp(join(base, 'minion-dependency-'));
    const entry = join(dir, 'fixture.ts');
    await writeFile(entry, browserFixture);
    const built = spawnSync('bun', ['build', entry, '--target=browser', '--outdir', dir], {
      encoding: 'utf8',
      timeout: 30000,
    });
    if (built.status !== 0) {
      await rm(dir, { recursive: true, force: true });
      throw new Error(built.stderr || 'Browser fixture build failed');
    }
    const bundle = await readFile(join(dir, 'fixture.js'));
    const server = createServer((req, res) => {
      if (req.url === '/fixture.js') {
        res.setHeader('content-type', 'text/javascript');
        res.end(bundle);
        return;
      }
      res.setHeader('content-type', 'text/html');
      res.end(
        '<!doctype html><meta charset="utf-8"><title>Minion dependency fixture</title><style>body{font:16px system-ui;margin:32px;background:#101820;color:#edf3f6}#editor{border:1px solid #74808b;padding:16px}li{margin:10px}h1{font-size:24px}</style><h1>Minion dependency compatibility</h1><div id="editor"></div><ul id="results"></ul><script src="/fixture.js"></script>',
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing loopback port');
    try {
      const script = `import json, os, shutil
new_tab("http://127.0.0.1:${address.port}")
wait_for_load()
result=json.loads(js("JSON.stringify(window.__dependencyChecks())"))
print(json.dumps(result))
shutil.copy(capture_screenshot(), os.environ.get("MINION_DEPENDENCY_SCREENSHOT", "/tmp/minion-dependency-security.png"))
`;
      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn('browser-harness', [], {
          env: {
            ...process.env,
            BU_NAME: process.env.BU_NAME ?? 'minion-360-deps',
            BU_CDP_URL: process.env.BU_CDP_URL ?? 'http://127.0.0.1:9223',
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '',
          stderr = '';
        const timeout = setTimeout(() => {
          child.kill();
          reject(new Error('Browser Harness exceeded 45s'));
        }, 45000);
        child.stdout.on('data', (chunk) => {
          stdout += String(chunk);
        });
        child.stderr.on('data', (chunk) => {
          stderr += String(chunk);
        });
        child.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.on('close', (code) => {
          clearTimeout(timeout);
          code === 0 ? resolve(stdout) : reject(new Error(stderr || stdout));
        });
        child.stdin.end(script);
      });
      const result = JSON.parse(output.trim().split('\n').at(-1) ?? 'null') as {
        passed: string[];
        failed: string[];
      };
      expect(result.failed).toEqual([]);
      expect(result.passed).toHaveLength(4);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    }
  },
  60000,
);

const browserFixture = String.raw`
import createDOMPurify from 'dompurify';
import { Editor, mergeAttributes } from '@tiptap/core';
import { DOMSerializer } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { Markdown } from 'tiptap-markdown';
window.__dependencyChecks=()=>{
  const passed=[],failed=[];
  const check=(name,fn)=>{try{fn();passed.push(name)}catch(error){failed.push(name+': '+error.message)}};
  const assert=(value,message)=>{if(!value)throw new Error(message)};
  check('prototype attributes',()=>{
    const attrs=mergeAttributes(JSON.parse('{"__proto__":{"onerror":"synthetic()","data-probe":"inherited"}}'));
    const image=DOMSerializer.renderSpec(document,['img',attrs]).dom;
    assert(!image.hasAttribute('onerror')&&!image.hasAttribute('data-probe'),'inherited executable attributes');
  });
  check('editor paste and Markdown',()=>{
    const editor=new Editor({element:document.querySelector('#editor'),extensions:[StarterKit,Highlight,Image.configure({allowBase64:false}),Markdown.configure({html:true,transformPastedText:true,transformCopiedText:true})],content:'## Fixture\n\n**bold** and _italic_'});
    assert(editor.getHTML().includes('<strong>bold</strong>'),'bold roundtrip');
    editor.view.pasteHTML('<p onclick="synthetic()">safe <img onerror="synthetic()"></p><script>synthetic()</script>');
    const rendered=document.createElement('div');rendered.innerHTML=editor.getHTML();assert(!rendered.querySelector('script,[onerror],[onclick]'),'unsafe paste');
    const markdown=editor.storage.markdown.getMarkdown();assert(markdown.includes('**bold**'),'Markdown serialization');
    editor.commands.setContent(markdown);assert(editor.getText().includes('Fixture'),'Markdown reload');
  });
  check('ordinary sanitizer',()=>{
    const purify=createDOMPurify(window);
    const clean=purify.sanitize('<p><strong>safe</strong><img onerror="synthetic()"><script>synthetic()</script><a href="javascript:synthetic()">link</a></p>');
    assert(!/onerror|javascript:|<script/.test(clean),'executable HTML');assert(clean.includes('<strong>safe</strong>'),'formatting lost');
  });
  check('detached sanitizer subtree',()=>{
    const purify=createDOMPurify(window);const root=document.createElement('div');root.innerHTML='<footer><img onload="synthetic()"></footer><div>safe</div>';
    const image=root.querySelector('img');purify.addHook('uponSanitizeElement',node=>{if(node.nodeName==='FOOTER')node.remove()});
    purify.sanitize(root,{IN_PLACE:true,ALLOWED_TAGS:['div','footer','#text']});assert(!image.hasAttribute('onload'),'detached handler retained');
  });
  document.querySelector('#results').replaceChildren(...[...passed.map(x=>'PASS: '+x),...failed.map(x=>'FAIL: '+x)].map(text=>{const li=document.createElement('li');li.textContent=text;return li}));
  return{passed,failed};
};
`;
