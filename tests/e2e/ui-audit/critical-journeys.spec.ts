import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { ASSISTANT_INVALIDATIONS } from './critical-cases';
import {
  openAssistant,
  sendUser,
  nextMain,
  respond,
  transition,
  settled,
  keyboardStop,
  contexts,
  mutationResult,
  assistantSnapshot,
  bindingFor,
  actualSends,
  advanceAssistantTime,
  pauseAssistantTimers,
  assertRevoked,
  attachAssistantEvidence,
  uiCalls,
  type AssistantWindow,
  type AssistantSnapshot,
} from './assistant-critical-helpers';

type Snapshot = {
  connected: boolean;
  requests: {
    method: string;
    params?: { message?: string; sessionKey?: string; idempotencyKey?: string; runId?: string };
  }[];
  unexpected: string[];
};
type FixtureWindow = Window & {
  __critical?: { snapshot(): Snapshot; releaseHandshake(): void; finishTurn(): void };
  __overlayFixture?: { fail(): void; succeed(): void; reopen(): Promise<void> };
};
const snapshot = (page: Page) =>
  page.evaluate(() => (window as FixtureWindow).__critical!.snapshot());
const violations = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, browser }, info) => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(process.env.MINION_CRITICAL_OUT!, 'manifest.json'), 'utf8'),
  ) as { files: { path: string }[] };
  const allowed = new Set(manifest.files.map((f) => '/' + f.path));
  const rejected: string[] = [];
  violations.set(page, rejected);
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (
      url.origin === 'http://127.0.0.1:18903' &&
      allowed.has(url.pathname) &&
      route.request().method() === 'GET'
    )
      await route.continue();
    else {
      rejected.push(route.request().url());
      await route.abort('blockedbyclient');
    }
  });
  page.on('websocket', (ws) => rejected.push('native WebSocket: ' + ws.url()));
  page.on('pageerror', (err) => rejected.push('pageerror: ' + err.message));
  await info.attach('runtime-identity', {
    body: JSON.stringify({
      browser: browser.version(),
      project: info.project.name,
      viewport: info.project.use.viewport,
      auth: 'none; synthetic fixture',
    }),
    contentType: 'application/json',
  });
});
test.afterEach(async ({ page }, info) => {
  await info.attach('network-boundary', {
    body: JSON.stringify({
      unexpectedNativeRequestsOrErrors: violations.get(page) ?? [],
      allowedOrigin: 'http://127.0.0.1:18903',
      transport: 'synthetic; no backend authentication',
    }),
    contentType: 'application/json',
  });
  expect(violations.get(page)).toEqual([]);
  if (page.url().includes('/home.html') || page.url().includes('/eval.html'))
    expect((await snapshot(page)).unexpected).toEqual([]);
});

test('CJ1 Home requires a completed real-client handshake before send', async ({ page }) => {
  await page.goto('/home.html?hold');
  const input = page.getByRole('textbox', { name: 'Chat with your agent' });
  await expect(input).toBeVisible();
  await expect
    .poll(async () => (await snapshot(page)).requests.filter((r) => r.method === 'connect').length)
    .toBe(1);
  expect((await snapshot(page)).connected).toBe(false);
  await input.fill('Blocked before handshake');
  await input.press('Enter');
  expect((await snapshot(page)).requests.filter((r) => r.method === 'chat.send')).toHaveLength(0);
  await page.evaluate(() => (window as FixtureWindow).__critical!.releaseHandshake());
  await expect.poll(async () => (await snapshot(page)).connected).toBe(true);
});

test('CJ2 Home sends once and renders the synthetic gateway response', async ({ page }) => {
  await page.goto('/home.html');
  await expect.poll(async () => (await snapshot(page)).connected).toBe(true);
  const input = page.getByRole('textbox', { name: 'Chat with your agent' });
  await input.fill('Fixture request canary');
  await input.press('Enter');
  await expect
    .poll(
      async () => (await snapshot(page)).requests.filter((r) => r.method === 'chat.send').length,
    )
    .toBe(1);
  expect(
    (await snapshot(page)).requests.find((r) => r.method === 'chat.send')?.params?.message,
  ).toContain('Fixture request canary');
  await input.fill('Second request while the first turn is pending');
  await input.press('Enter');
  expect((await snapshot(page)).requests.filter((r) => r.method === 'chat.send')).toHaveLength(1);
  await page.evaluate(() => (window as FixtureWindow).__critical!.finishTurn());
  await expect(page.getByText('Synthetic response received.', { exact: true })).toBeVisible();
  // A fresh accepted turn is stopped through the actual exact-run RPC path.
  await input.fill('Stop this accepted fixture turn');
  await input.press('Enter');
  await expect
    .poll(
      async () => (await snapshot(page)).requests.filter((r) => r.method === 'chat.send').length,
    )
    .toBe(2);
  const accepted = (await snapshot(page)).requests.filter((r) => r.method === 'chat.send').at(-1)!;
  await page.getByRole('button', { name: /Stop/i }).click();
  await expect
    .poll(
      async () => (await snapshot(page)).requests.filter((r) => r.method === 'chat.abort').length,
    )
    .toBe(1);
  const stopped = await snapshot(page);
  expect(stopped.requests.find((r) => r.method === 'chat.abort')?.params).toEqual({
    sessionKey: accepted.params?.sessionKey,
    runId: accepted.params?.idempotencyKey,
  });
  await expect(page.getByText('Synthetic response stopped.', { exact: true })).toBeVisible();
  expect((await snapshot(page)).requests.filter((r) => r.method === 'chat.send')).toHaveLength(2);
  // A new explicit request proves the composer recovered; it gets a fresh ID.
  await input.fill('Fresh request after Stop');
  await input.press('Enter');
  await expect
    .poll(
      async () => (await snapshot(page)).requests.filter((r) => r.method === 'chat.send').length,
    )
    .toBe(3);
  const sends = (await snapshot(page)).requests.filter((r) => r.method === 'chat.send');
  expect(new Set(sends.map((r) => r.params?.idempotencyKey)).size).toBe(3);
  expect((await snapshot(page)).requests.filter((r) => r.method === 'chat.abort')).toHaveLength(1);
  await page.evaluate(() => (window as FixtureWindow).__critical!.finishTurn());
  await expect(page.getByText('Synthetic response received.', { exact: true })).toHaveCount(2);
});

test('CJ3 Calendar staff lanes stay reachable', async ({ page }) => {
  await page.goto('/calendar.html');
  await expect(page.getByRole('button', { name: 'Today', exact: true })).toBeVisible();
  // Scheduling uses the shared calendar grid. Exclude its aggregate “All”
  // column and require every synthetic staff lane, not the retired renderer.
  const lanes = page.locator('.col:not(.is-all) > .col-head');
  await expect(lanes).toHaveCount(6);
  await expect(lanes.locator('.head-name')).toHaveText([
    'Leiva',
    'Martin',
    'Nikolas Pinon',
    'Nikolas Sarria',
    'Nikolas Sebastian Pinon Sarria',
    'Renzo GT',
  ]);
  await lanes.last().scrollIntoViewIfNeeded();
  const box = await lanes.last().boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(112);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  await page.getByRole('button', { name: 'Today', exact: true }).focus();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
});

test('CJ4 Secret save blocks dismissal and duplicate submission, then retries', async ({
  page,
}) => {
  await page.goto('/overlay.html');
  await page.locator('#open-secret').click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('Paste secret value').fill('synthetic-value');
  await dialog.getByRole('button', { name: 'Save & probe' }).click();
  await expect(page.locator('#fixture-state')).toHaveAttribute('data-saves', '1');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save & probe' })).toBeDisabled();
  await page.evaluate(() => (window as FixtureWindow).__overlayFixture!.fail());
  await expect(dialog.getByText('Fixture save failed')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save & probe' }).click();
  await expect(page.locator('#fixture-state')).toHaveAttribute('data-saves', '2');
  await page.evaluate(() => (window as FixtureWindow).__overlayFixture!.succeed());
  await expect(dialog.getByText('Verified test response', { exact: true })).toBeVisible();
  await dialog
    .getByRole('button', { name: 'Close', exact: true })
    .and(dialog.locator('[data-part="button"]'))
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#open-secret')).toBeFocused();
});

test('CJ5 Image dialog prevents background focus and returns it on Escape', async ({
  page,
}, info) => {
  await page.goto('/overlay.html');
  await page.locator('#open-image').click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toBeVisible();
  const focusStates = [];
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    const state = await page.evaluate(() => ({
      inDialog: document.querySelector('dialog[open]')?.contains(document.activeElement),
      nativeModal: !!document.querySelector('dialog:modal'),
      documentFocused: document.hasFocus(),
      tag: document.activeElement?.tagName,
      id: document.activeElement?.id,
    }));
    focusStates.push(state);
    expect(
      // Native traversal may visit browser chrome. Headless Chromium can
      // report BODY while hasFocus() is still true during that transition.
      // Only BODY is permitted outside the native modal; an interactive
      // background target must never receive focus.
      state.inDialog || (state.nativeModal && state.tag === 'BODY'),
      JSON.stringify(state),
    ).toBe(true);
  }
  expect(focusStates.some((state) => state.inDialog)).toBe(true);
  await info.attach('native-focus-states', {
    body: JSON.stringify(focusStates),
    contentType: 'application/json',
  });
  await page.locator('#background').focus();
  await expect(page.locator('#background')).not.toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#open-image')).toBeFocused();
});

test('CJ6 Secret close and rapid reopen retain a working native dialog', async ({ page }) => {
  await page.goto('/overlay.html');
  await page.locator('#open-secret').click();
  await expect(page.locator('dialog[open]')).toBeVisible();
  await page.evaluate(() => (window as FixtureWindow).__overlayFixture!.reopen());
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('#open-secret')).toBeFocused();
});

test('CJA1 Home and Floating retain accepted cancellation through smoothing and keyboard Stop', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  for (const [surface, locale] of contexts) {
    await openAssistant(page, surface, locale);
    const request = await sendUser(page, 'Stop this exact accepted fixture run');
    let state = await assistantSnapshot(page);
    expect(bindingFor(state, request.runId)).toMatchObject({
      state: 'unclaimed',
      signalAborted: false,
    });
    await pauseAssistantTimers(page);
    await respond(
      page,
      request,
      {
        text:
          'A deliberately long fixture response. '.repeat(250) +
          '\n' +
          uiCalls([
            {
              tool: 'sandbox.upsert_element',
              input: { title: 'Forbidden after Stop', html: '', js: '' },
            },
          ]),
      },
      { ack: 'after', duplicateFinal: true },
    );
    state = await assistantSnapshot(page);
    expect(state.chat.runId).toBeNull();
    expect(bindingFor(state, request.runId)).toMatchObject({
      state: 'claimed',
      signalAborted: false,
    });
    await keyboardStop(page);
    await expect
      .poll(
        async () =>
          (await snapshot(page)).requests.filter((row) => row.method === 'chat.abort').length,
      )
      .toBe(1);
    expect(
      (await snapshot(page)).requests.find((row) => row.method === 'chat.abort')?.params,
    ).toEqual({ runId: request.runId, sessionKey: request.sessionKey });
    await transition(page, { action: 'duplicate_final' });
    await page.clock.resume();
    await settled(page);
    state = await assistantSnapshot(page);
    expect(bindingFor(state, request.runId)).toMatchObject({
      state: 'canceled',
      signalAborted: true,
    });
    expect(state.receipts).toHaveLength(0);
    expect(await actualSends(page)).toHaveLength(1);
    await attachAssistantEvidence(info, page, `accepted-stop-${surface}-${locale}`, [state]);
  }
});

test('CJA2 An acknowledged real sandbox reload permits one fresh continuation and no remaining old calls', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  for (const [surface, locale] of contexts) {
    await openAssistant(page, surface, locale);
    const request = await sendUser(page, 'Create one disposable visual');
    await transition(page, { action: 'hold_reload', hold: true });
    await respond(page, request, mutationResult, { ack: 'after', duplicateFinal: true });
    await expect.poll(async () => (await assistantSnapshot(page)).pendingReloads).toBe(1);
    let state = await assistantSnapshot(page);
    expect(state.receipts).toHaveLength(1);
    expect(bindingFor(state, request.runId)).toMatchObject({
      state: 'claimed',
      signalAborted: false,
    });
    await transition(page, { action: 'release_reload' });
    const follow = await nextMain(page);
    state = await assistantSnapshot(page);
    expect(bindingFor(state, follow.runId)).toMatchObject({
      parentRunId: request.runId,
      taskRootId: request.runId,
      origin: 'ui_followup',
      followUpCount: 1,
      signalAborted: false,
    });
    expect(follow.message).toContain('Installed fixture visual');
    expect(follow.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(follow.messages[0].content).toBe(request.message);
    expect(follow.messages[2].content).toBe(follow.message);
    expect(follow.messages.filter((message) => message.content === follow.message)).toHaveLength(1);
    expect(
      state.http.filter((row) => row.method === 'GET' && row.path === '/api/sandbox/elements'),
    ).toHaveLength(1);
    await respond(page, follow, { text: 'The disposable fixture visual is ready.' });
    await settled(page);
    await transition(page, { action: 'duplicate_final' });
    await transition(page, { action: 'compaction' });
    await settled(page);
    state = await assistantSnapshot(page);
    expect(state.receipts).toHaveLength(1);
    expect(await actualSends(page)).toHaveLength(2);
    const compacted = await sendUser(page, 'Continue from the compacted fixture history');
    expect(compacted.messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
    expect(compacted.messages[0].content).toBe('Disposable server history compaction fixture.');
    expect(compacted.messages[1].content).toBe(follow.message);
    expect(compacted.messages[2].content).toBe('The disposable fixture visual is ready.');
    expect(compacted.messages[3].content).toBe(compacted.message);
    await respond(page, compacted, { text: 'The compacted fixture context is retained.' });
    await settled(page);
    state = await assistantSnapshot(page);
    expect(state.receipts).toHaveLength(1);
    expect(await actualSends(page)).toHaveLength(3);
    await attachAssistantEvidence(info, page, `owned-handoff-${surface}-${locale}`, [state]);
  }
});

ASSISTANT_INVALIDATIONS.forEach((variant, index) => {
  test(`CJA${index + 3} Held sandbox mutation rejects continuation after ${variant}`, async ({
    page,
  }, info) => {
    test.setTimeout(120000);
    for (const [surface, locale] of contexts) {
      await openAssistant(page, surface, locale);
      const request = await sendUser(page, 'Create one disposable visual under this page owner');
      await transition(page, { action: 'hold_reload', hold: true });
      await respond(page, request, mutationResult);
      await expect.poll(async () => (await assistantSnapshot(page)).pendingReloads).toBe(1);
      expect((await assistantSnapshot(page)).receipts).toHaveLength(1);
      if (variant === 'owner_aba') {
        await transition(page, { action: 'owner', actor: 'b', org: 'b' });
        await transition(page, { action: 'owner', actor: 'a', org: 'a' });
      }
      if (variant === 'session_aba') {
        await transition(page, { action: 'session', session: 'other' });
        await transition(page, { action: 'session', session: 'main' });
      }
      if (variant === 'navigation_aba') {
        await transition(page, { action: 'page', page: 'crm' });
        await transition(page, { action: 'page', page: 'sandbox' });
      }
      if (variant === 'registry') await transition(page, { action: 'registry_change' });
      if (variant === 'forged_notification') await transition(page, { action: 'window_reload' });
      if (variant === 'reordered_reload') {
        await transition(page, { action: 'window_reload' });
        await transition(page, { action: 'window_reload' });
        await expect.poll(async () => (await assistantSnapshot(page)).pendingReloads).toBe(2);
        await transition(page, { action: 'release_reload', order: 'latest' });
      }
      if (variant === 'stop') await keyboardStop(page);
      if (variant === 'source_teardown') await transition(page, { action: 'page', page: 'crm' });
      if (variant === 'expired_capability') await advanceAssistantTime(page, 30001);
      await transition(page, {
        action: 'release_reload',
        fail: variant === 'failed_refresh',
        order: 'oldest',
      });
      const state = await assertRevoked(page, request.runId);
      expect(
        state.http.filter((row) => row.method === 'POST' && row.path === '/api/sandbox/elements'),
      ).toHaveLength(1);
      await attachAssistantEvidence(info, page, `${variant}-${surface}-${locale}`, [state]);
    }
  });
});

test('CJA13 Unknown, expired and reloaded finals render without automatic action authority', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  for (const [surface, locale] of contexts) {
    for (const mode of ['unknown', 'expired', 'reload'] as const) {
      await openAssistant(page, surface, locale);
      const result = {
        text:
          `Visible ${mode} fixture history.\n` +
          uiCalls([
            {
              tool: 'sandbox.upsert_element',
              input: { title: 'Must not execute', html: '', js: '' },
            },
          ]),
      };
      if (mode === 'unknown')
        await page.evaluate(
          (result) =>
            (window as AssistantWindow).__eval.receiveUnknownFinal(
              '11111111-1111-4111-8111-111111111111',
              'agent:fixture-agent:main',
              result,
            ),
          result,
        );
      else {
        const request = await sendUser(page, 'Retire this source before its final');
        if (mode === 'expired') {
          await advanceAssistantTime(page, 2 * 60 * 60 * 1000 + 1);
          await respond(page, request, result);
        } else {
          await page.reload();
          await expect
            .poll(() =>
              page.evaluate(
                () => (window as AssistantWindow).__critical?.snapshot().connected ?? false,
              ),
            )
            .toBe(true);
          await page.evaluate(
            ({ request, result }) =>
              (window as AssistantWindow).__eval.receiveUnknownFinal(
                request.runId,
                request.sessionKey,
                result,
              ),
            { request, result },
          );
        }
      }
      await expect(
        page.getByText(`Visible ${mode} fixture history.`, { exact: true }),
      ).toBeVisible();
      await settled(page);
      const state = await assistantSnapshot(page);
      expect(state.receipts).toHaveLength(0);
      expect(
        state.observations.filter(
          (event) => event.kind === 'run_relation' && event.origin === 'ui_followup',
        ),
      ).toHaveLength(0);
      await attachAssistantEvidence(info, page, `retired-${mode}-${surface}-${locale}`, [state]);
    }
  }
});

test('CJA14 The five automatic follow-up cap preserves explicit callbacks and typed new roots', async ({
  page,
}, info) => {
  test.setTimeout(180000);
  for (const [surface, locale] of contexts) {
    for (const origin of ['ui_choice', 'artifact'] as const) {
      await openAssistant(page, surface, locale, { arm: 'core_discovery' });
      const root = await sendUser(page, 'Read this fixture until a human choice is required');
      await page.evaluate(() => (window as AssistantWindow).__eval.holdHistory(true));
      let request = root;
      for (let count = 0; count < 5; count++) {
        await respond(page, request, {
          text: uiCalls([{ tool: 'sandbox.list_elements', input: {} }]),
        });
        request = await nextMain(page);
        expect(bindingFor(await assistantSnapshot(page), request.runId)).toMatchObject({
          taskRootId: root.runId,
          followUpCount: count + 1,
          origin: 'ui_followup',
        });
      }
      const question = uiCalls([
        { tool: 'sandbox.list_elements', input: {} },
        {
          tool: 'ui.choice',
          input: {
            question: 'Choose the next fixture step',
            options: [{ label: 'Continue explicit fixture' }],
          },
        },
      ]);
      await respond(
        page,
        request,
        origin === 'ui_choice'
          ? { text: question }
          : {
              message: {
                role: 'assistant',
                content: [
                  { type: 'text', text: uiCalls([{ tool: 'sandbox.list_elements', input: {} }]) },
                  {
                    type: 'toolCall',
                    id: 'installed-cap-artifact',
                    name: 'chat_artifact',
                    arguments: {
                      html: '',
                      buttons: [
                        { text: 'Continue explicit artifact', callback_data: 'INSTALLED_CALLBACK' },
                      ],
                    },
                  },
                ],
              },
            },
      );
      await settled(page);
      expect(await actualSends(page)).toHaveLength(6);
      await page
        .getByRole('button', {
          name: origin === 'ui_choice' ? 'Continue explicit fixture' : 'Continue explicit artifact',
          exact: true,
        })
        .click();
      const explicit = await nextMain(page);
      let state = await assistantSnapshot(page);
      expect(bindingFor(state, explicit.runId)).toMatchObject({
        taskRootId: root.runId,
        parentRunId: request.runId,
        followUpCount: 5,
        origin,
      });
      expect(state.http.filter((row) => row.path === '/api/assistant/route')).toHaveLength(1);
      const applied = state.observations.find(
        (event) => event.kind === 'decision_applied' && event.submissionId === explicit.runId,
      );
      expect(applied).toMatchObject({
        decision_disposition: 'bypass',
        loaded_pages: true,
        loaded_forms: true,
        loaded_data: true,
        loaded_brain: true,
        loaded_changelog: true,
        loaded_sandbox: true,
      });
      await respond(page, explicit, {
        text: uiCalls([{ tool: 'sandbox.list_elements', input: {} }]),
      });
      await settled(page);
      expect(await actualSends(page)).toHaveLength(7);
      const typed = await sendUser(page, 'A new typed fixture task');
      state = await assistantSnapshot(page);
      expect(bindingFor(state, typed.runId)).toMatchObject({
        taskRootId: typed.runId,
        parentRunId: null,
        followUpCount: 0,
        origin: 'user',
      });
      expect(state.http.filter((row) => row.path === '/api/assistant/route')).toHaveLength(2);
      await respond(page, typed, { text: 'The new fixture task is complete.' });
      await settled(page);
      await page.evaluate(() => (window as AssistantWindow).__eval.releaseHistory());
      await expect.poll(async () => (await assistantSnapshot(page)).pendingHistoryReplies).toBe(0);
      state = await assistantSnapshot(page);
      await attachAssistantEvidence(info, page, `cap-${origin}-${surface}-${locale}`, [state]);
    }
  }
});

test('CJA15 Unknown acknowledgements, terminal late finals and navigation remain fenced', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  for (const [surface, locale] of contexts) {
    await openAssistant(page, surface, locale);
    let request = await sendUser(page, 'Recover this fixture acknowledgement without replay');
    await page.evaluate(
      (id) => (window as AssistantWindow).__eval.rejectAcknowledgement(id),
      request.requestId,
    );
    await expect
      .poll(async () => bindingFor(await assistantSnapshot(page), request.runId)?.transport)
      .toBe('unknown');
    expect(await actualSends(page)).toHaveLength(1);
    await respond(page, request, mutationResult, { ack: 'missing', duplicateFinal: true });
    const follow = await nextMain(page);
    await respond(page, follow, { text: 'Recovered one committed fixture visual.' });
    await settled(page);
    let state = await assistantSnapshot(page);
    expect(state.receipts).toHaveLength(1);
    expect(await actualSends(page)).toHaveLength(2);
    await attachAssistantEvidence(info, page, `unknown-ack-${surface}-${locale}`, [state]);
    await openAssistant(page, surface, locale);
    request = await sendUser(page, 'A terminal fixture must not regain action authority');
    await respond(page, request, mutationResult, { ack: 'after', error: 'transport' });
    await transition(page, { action: 'duplicate_final' });
    await settled(page);
    state = await assistantSnapshot(page);
    expect(state.receipts).toHaveLength(0);
    expect(bindingFor(state, request.runId)?.signalAborted).toBe(true);
    expect(await actualSends(page)).toHaveLength(1);
    await attachAssistantEvidence(info, page, `terminal-late-${surface}-${locale}`, [state]);
    await openAssistant(page, surface, locale);
    request = await sendUser(page, 'Offer an explicit page link');
    await respond(page, request, {
      text: uiCalls([
        {
          tool: 'sandbox.upsert_element',
          input: { title: 'Old-page call must not run', html: '', js: '' },
        },
        { tool: 'hub.navigate', input: { path: '/sandbox' } },
        { tool: 'sandbox.list_elements', input: {} },
      ]),
    });
    await settled(page);
    state = await assistantSnapshot(page);
    expect(state.receipts).toHaveLength(0);
    expect(state.http.filter((row) => row.path === '/api/sandbox/elements')).toHaveLength(0);
    expect(await actualSends(page)).toHaveLength(1);
    expect(
      await page.evaluate(
        () => (window as Window & { __fixtureNav?: string[] }).__fixtureNav ?? [],
      ),
    ).toEqual([]);
    await attachAssistantEvidence(info, page, `navigation-${surface}-${locale}`, [state]);
  }
});
