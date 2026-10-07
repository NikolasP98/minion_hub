/**
 * HC-028 native proof: drives the built fixture in an isolated headless
 * Chromium (Playwright's own binary, not the shared browser daemon) and
 * asserts, per migrated overlay: `dialog:modal`, inert background (focus()
 * on a background control is a no-op; Tab/Shift+Tab never land on one),
 * body scroll lock, Escape pressed INSIDE the innermost control closes,
 * focus returns to the trigger, scroll lock released, and the stated
 * outside-click policy (all seven are dismissible).
 *
 *   node tests/fixtures/overlay-dialog/build.mjs
 *   node tests/fixtures/overlay-dialog/verify.mjs
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hub = fileURLToPath(new URL('../../../', import.meta.url));
const dir = process.env.MINION_OVERLAY_DIALOG_OUT ?? '/tmp/minion-overlay-dialog-fixture';
const out = process.env.MINION_OVERLAY_DIALOG_EVIDENCE ?? '/tmp/minion-overlay-dialog-evidence';
fs.mkdirSync(out, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const rel = req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(dir, rel);
  if (!file.startsWith(dir) || !fs.existsSync(file)) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const background = ['open-hosts', 'open-delete', 'open-sheet', 'open-wizard', 'open-export', 'open-chapter', 'open-condition', 'background'];
const cases = [
  { id: 'open-hosts', inner: '#host-url' },
  { id: 'open-delete', inner: '.confirm-btn.cancel' },
  { id: 'open-sheet', inner: '.detail-btn.secondary' },
  { id: 'open-wizard', inner: '.name-input' },
  { id: 'open-export', inner: '.col' },
  { id: 'open-chapter', inner: '.confirm-btn.cancel' },
  { id: 'open-condition', inner: '#cond-text' },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url);
await page.waitForSelector('#open-condition');

const active = () => page.evaluate(() => document.activeElement?.id ?? document.activeElement?.tagName);
const modalOpen = () => page.evaluate(() => document.querySelector('dialog:modal') !== null);
const overflow = () => page.evaluate(() => document.body.style.overflow);
const closed = async () => {
  await page.waitForFunction(() => !document.querySelector('dialog:modal'), null, { timeout: 3000 });
};
function check(cond, label) {
  if (!cond) throw new Error('FAILED: ' + label);
  return label;
}

const results = [];
for (const { id, inner } of cases) {
  const steps = [];
  await page.click('#' + id);
  await page.waitForSelector('dialog:modal');
  steps.push(check(await modalOpen(), `${id}: dialog:modal`));
  steps.push(check((await overflow()) === 'hidden', `${id}: body overflow hidden`));
  steps.push(
    check(
      await page.evaluate(() => {
        document.getElementById('background').focus();
        return document.activeElement.id !== 'background';
      }),
      `${id}: background focus() is a no-op (inert)`,
    ),
  );
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    check(!background.includes(await active()), `${id}: Tab ${i} stays inside`);
  }
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Shift+Tab');
    check(!background.includes(await active()), `${id}: Shift+Tab ${i} stays inside`);
  }
  steps.push(`${id}: 12×Tab + 12×Shift+Tab never reach a background control`);
  await page.screenshot({ path: path.join(out, `hc028-${id}.png`) });
  await page.focus(inner);
  steps.push(check(await page.evaluate((s) => document.activeElement.matches(s), inner), `${id}: focus is inside ${inner}`));
  await page.keyboard.press('Escape');
  await closed();
  steps.push(`${id}: Escape inside ${inner} closed the dialog`);
  await page.waitForFunction((t) => document.activeElement?.id === t, id, { timeout: 2000 });
  steps.push(`${id}: focus returned to #${id}`);
  steps.push(check((await overflow()) === '', `${id}: body overflow released`));

  // Outside-click policy: dismissible (click lands on the <dialog> backdrop area).
  await page.click('#' + id);
  await page.waitForSelector('dialog:modal');
  await page.mouse.click(8, 880);
  await closed();
  steps.push(`${id}: outside click dismissed`);
  await page.waitForFunction((t) => document.activeElement?.id === t, id, { timeout: 2000 });
  results.push({ id, inner, steps });
}

await browser.close();
server.close();
const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: hub, encoding: 'utf8' }).trim();
const proof = { finding: 'HC-028', gitHead, chromium: browser.version(), url: 'fixture (loopback, no app server)', pageErrors: errors, cases: results };
fs.writeFileSync(path.join(out, 'hc028-native-proof.json'), JSON.stringify(proof, null, 2) + '\n');
if (errors.length) throw new Error('page errors: ' + errors.join('\n'));
console.log(JSON.stringify({ passed: results.length, checks: results.reduce((n, r) => n + r.steps.length, 0), evidence: out }));
