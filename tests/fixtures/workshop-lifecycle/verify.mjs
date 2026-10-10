/**
 * HC-037 native Chromium proof. Drives the built fixture in an ISOLATED headless
 * Chromium reached over CDP (never the shared browser-harness daemon):
 *
 *   chromium --headless=new --remote-debugging-port=9237 --user-data-dir=<tmp> about:blank
 *   python3 -m http.server 8837 --bind 127.0.0.1   (from the fixture output dir)
 *   node tests/fixtures/workshop-lifecycle/verify.mjs
 *
 * Env: HC037_CDP (default http://127.0.0.1:9237), HC037_URL (default
 * http://127.0.0.1:8837/index.html), HC037_EVIDENCE (screenshot + receipt dir).
 * Synthetic transport only: no login, no production data, no real requests.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const CDP = process.env.HC037_CDP ?? 'http://127.0.0.1:9237';
const URL = process.env.HC037_URL ?? 'http://127.0.0.1:8837/index.html';
const E = process.env.HC037_EVIDENCE ?? '/tmp/minion-workshop-lifecycle-evidence';
fs.mkdirSync(E, { recursive: true });

const receipt = { cdp: CDP, url: URL, checks: [], screenshots: [] };
const check = (name, pass, detail) => {
  receipt.checks.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' ' + JSON.stringify(detail).slice(0, 240)}`);
};
const STATE = (agents) => ({
  camera: { x: 1, y: 2, zoom: 1 },
  agents: Object.fromEntries(
    agents.map((a) => [a, { instanceId: a, agentId: 'x', position: { x: 0, y: 0 }, behavior: 'stationary' }]),
  ),
  relationships: {},
  elements: {},
  settings: {},
});
const SAVE = (id, agents) => ({ save: { id, name: id, state: STATE(agents) } });
const LIST = {
  saves: ['A', 'B'].map((id) => ({ id, name: `Workspace ${id}`, updatedAt: 0, createdAt: 0, thumbnail: null, agentCount: 1, elementCount: 0 })),
};

const browser = await chromium.connectOverCDP(CDP);
const context = browser.contexts()[0] ?? (await browser.newContext());
const page = await context.newPage();
await page.setViewportSize({ width: 1280, height: 900 });
const sleep = (ms) => page.waitForTimeout(ms);
const ev = (fn, arg) => page.evaluate(fn, arg);
const shot = async (name) => {
  await page.screenshot({ path: path.join(E, `${name}.png`) });
  receipt.screenshots.push(`${name}.png`);
};
const settleLast = (how, payload) => ev(([how, payload]) => window.__hc037.calls.at(-1)[how](payload), [how, payload]);
const snap = () =>
  ev(() => ({
    active: window.__hc037.ws.saveSync.activeSaveId,
    status: window.__hc037.ws.saveSync.status,
    lastSavedAt: window.__hc037.ws.saveSync.lastSavedAt,
    agents: Object.keys(window.__hc037.ws.workshopState.agents).sort(),
    gotos: [...window.__hc037.gotos],
    persisted: localStorage.getItem('workshop:activeSaveId'),
    lastKey: window.__hc037.calls.at(-1)?.key,
    calls: window.__hc037.calls.length,
    statusEl: document.querySelector('[data-save-status]')?.textContent.trim() ?? null,
  }));
const button = (name) => page.getByRole('button', { name, exact: true });

await page.goto(URL);
await page.waitForFunction(() => typeof window.__hc037 === 'object' && window.__hc037.calls.length >= 1);
check('fixture mounted; first captured request is the list', (await snap()).lastKey === 'GET /api/workshop/saves');
await settleLast('ok', LIST);
await button('Workspace A').waitFor();
await shot('00-list-loaded');

// ── (1) create after an existing workspace is loaded; server rejects ─────────
await ev(() => void window.__hc037.ws.openSave('A'));
await settleLast('ok', SAVE('A', ['a1']));
await sleep(200);
await ev(() => window.__hc037.ws.addAgentInstance('agent-local', 3, 4));
await sleep(200);
let s = await snap();
check('(1) pre: A loaded, one local edit, status unsaved', s.active === 'A' && s.agents.length === 2 && s.status === 'unsaved', s);
await shot('10-A-loaded-unsaved');
const before = s.calls;
await button('+ Create Blank').first().click();
await sleep(200);
s = await snap();
check('(1) native click dispatched one POST; create button busy', s.calls === before + 1 && s.lastKey === 'POST /api/workshop/saves' && (await button('+ Create Blank').first().getAttribute('aria-busy')) === 'true', { calls: s.calls, lastKey: s.lastKey });
const postAgents = await ev(() => Object.keys(JSON.parse(window.__hc037.calls.at(-1).body.state).agents).length);
check('(1) POST body is a blank snapshot while the live state is untouched', postAgents === 0 && (await snap()).agents.length === 2);
await shot('11-create-pending');
await settleLast('fail', 500);
await page.getByText('Could not create workspace').waitFor();
await shot('12-create-rejected-toast-state-preserved');
s = await snap();
check('(1) failure visible as a toast', true);
check('(1) state + selection preserved, no navigation', s.active === 'A' && s.agents.length === 2 && s.agents[0] === 'a1' && s.gotos.length === 0, s);
await sleep(3000);
const puts = await ev(() => window.__hc037.calls.filter((c) => c.key.startsWith('PUT ')).map((c) => ({ key: c.key, agents: Object.keys(JSON.parse(c.body.state).agents).length })));
check("(1) no autosave of reset data: every PUT targets A with A's 2 agents", puts.length >= 1 && puts.every((p) => p.key === 'PUT /api/workshop/saves/A' && p.agents === 2), puts);
const local = await ev(() => Object.keys(JSON.parse(localStorage.getItem('workshop:autosave:host-fixture:agents') ?? '{}')).length);
check("(1) host localStorage layout still holds A's 2 agents", local === 2, local);
await ev(() => window.__hc037.calls.filter((c) => c.key.startsWith('PUT ') && !c.settled).forEach((c) => c.ok({ ok: true })));
await sleep(200);

// ── (2) open A then B race; actor/org rotation ───────────────────────────────
await ev(() => (window.__hc037.gotos.length = 0));
const n0 = (await snap()).calls;
await button('Workspace A').click();
await sleep(100);
await button('Workspace B').click();
await sleep(200);
const keys = await ev((n0) => window.__hc037.calls.slice(n0).map((c) => c.key), n0);
check('(2) two native opens dispatched: A then B', keys.join() === 'GET /api/workshop/saves/A,GET /api/workshop/saves/B', keys);
await shot('20-race-both-pending');
await settleLast('ok', SAVE('B', ['b1']));
await sleep(300);
s = await snap();
check('(2) B published: identity, persisted key, navigation', s.active === 'B' && s.persisted === 'B' && s.gotos.join() === '/agents/workshop/B' && s.agents.join() === 'b1', s);
await ev((p) => window.__hc037.calls.at(-2).ok(p), SAVE('A', ['a1']));
await sleep(300);
s = await snap();
check('(2) late A dropped: B keeps state/identity/navigation', s.active === 'B' && s.persisted === 'B' && s.gotos.join() === '/agents/workshop/B' && s.agents.join() === 'b1', s);
await shot('21-race-late-A-dropped');
await ev(() => (window.__hc037.gotos.length = 0));
await button('Workspace A').click();
await sleep(150);
await ev(() => (window.__hc037.page.data.activeOrgId = 'org-2'));
await settleLast('ok', SAVE('A', ['a1']));
await sleep(300);
s = await snap();
check('(2) org rotated between dispatch and completion: completion dropped', s.active === 'B' && s.agents.join() === 'b1' && s.gotos.length === 0, s);
const n1 = s.calls;
await ev(() => window.__hc037.ws.addAgentInstance('agent-after-rotation', 0, 0));
await sleep(3000);
const rotatedPuts = await ev((n1) => window.__hc037.calls.slice(n1).filter((c) => c.key.startsWith('PUT ')).length, n1);
check('(2) a save owned by the rotated identity is not sent', rotatedPuts === 0, rotatedPuts);
await shot('22-rotation-dropped');
await ev(() => (window.__hc037.page.data.activeOrgId = 'org-1'));
await ev(() => void window.__hc037.ws.openSave('B'));
await settleLast('ok', SAVE('B', ['b1']));
await sleep(300);

// ── (3) autosave rejected / response lost ────────────────────────────────────
s = await snap();
check('(3) pre: freshly published workspace reads saved', s.status === 'saved', s.status);
await ev(() => window.__hc037.ws.addAgentInstance('agent-edit', 5, 5));
await sleep(150);
s = await snap();
check('(3) local edit → unsaved, visible in the toolbar', s.status === 'unsaved' && s.statusEl === 'Unsaved changes', s.statusEl);
await shot('30-unsaved');
await sleep(2600);
s = await snap();
check('(3) debounced PUT in flight → saving', s.lastKey === 'PUT /api/workshop/saves/B' && s.status === 'saving', { lastKey: s.lastKey, status: s.status });
await settleLast('fail', 500);
await sleep(300);
s = await snap();
check('(3) rejected → failed with Retry, no Saved clock', s.status === 'failed' && s.statusEl?.startsWith('Not saved') && s.statusEl.includes('Retry') && s.lastSavedAt === null, s.statusEl);
await shot('31-rejected-not-saved-retry');
const n2 = s.calls;
await sleep(6000);
check('(3) no silent replay while idle (6 s)', (await snap()).calls === n2);
await page.locator('[data-save-status="failed"]').getByRole('button', { name: 'Retry' }).click();
await sleep(200);
s = await snap();
const retryAgents = await ev(() => Object.keys(JSON.parse(window.__hc037.calls.at(-1).body.state).agents).length);
check('(3) explicit Retry sends exactly one PUT of the CURRENT state', s.calls === n2 + 1 && s.lastKey === 'PUT /api/workshop/saves/B' && retryAgents === 2, { calls: s.calls, retryAgents });
await settleLast('ok', { ok: true });
await sleep(300);
s = await snap();
check('(3) acknowledged → saved with clock', s.status === 'saved' && s.lastSavedAt !== null && (await page.getByText('Saved').first().isVisible()), s.status);
await shot('32-retry-acknowledged-saved');
await ev(() => window.__hc037.ws.addAgentInstance('agent-edit-2', 6, 6));
await sleep(2600);
await settleLast('lose');
await sleep(300);
s = await snap();
check('(3) lost response → unknown (neither saved nor failed) with Retry', s.status === 'unknown' && s.statusEl?.startsWith('Save status unknown') && s.statusEl.includes('Retry'), s.statusEl);
await shot('33-lost-response-unknown');
const n3 = s.calls;
await sleep(6000);
check('(3) unknown: no silent replay (6 s)', (await snap()).calls === n3);

// ── (4) delete failure on the list ───────────────────────────────────────────
await button('Delete Workspace A').click();
await sleep(150);
check('(4) native Delete dispatched a DELETE', (await snap()).lastKey === 'DELETE /api/workshop/saves/A');
await settleLast('fail', 500);
await page.getByText('Could not delete workspace').waitFor();
check('(4) delete failure visible; card kept', await button('Workspace A').isVisible());
await shot('40-delete-rejected');

receipt.userAgent = await ev(() => navigator.userAgent);
receipt.calls = await ev(() => window.__hc037.calls.map((c) => ({ key: c.key, settled: c.settled })));
receipt.allPass = receipt.checks.every((c) => c.pass);
fs.writeFileSync(path.join(E, 'hc037-native-proof.json'), JSON.stringify(receipt, null, 1));
console.log(receipt.allPass ? 'ALL PASS' : 'SOME FAILED', receipt.checks.filter((c) => c.pass).length, '/', receipt.checks.length);
await page.close();
await browser.close();
process.exit(receipt.allPass ? 0 : 1);
