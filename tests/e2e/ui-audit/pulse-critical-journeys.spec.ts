import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
type Snapshot = {
  feedbackCount?: number;
  requests: {
    method: string;
    path: string;
    body: { expectedRevision?: number; action?: string } | null;
  }[];
  unexpected: string[];
  decision: string;
  serverRevision: number;
  dispatches: number;
  heldReceipt: boolean;
  heldProjection: number;
  client: {
    pendingCount: number;
    itemCount: number;
    receiptState: string | null;
    error: string | null;
    busy: boolean;
  };
  scopeSwitchAt: number | null;
};
type PulseWindow = Window & {
  __pulseFixture?: {
    snapshot(): Snapshot;
    recover(): void;
    project(): void;
    reconnect(): Promise<void>;
    scheduled(): void;
    readDenied(): Promise<boolean>;
    holdNextReceipt(): void;
    startReceiptRead(): Promise<void>;
    holdProjectionRead(): Promise<void>;
    releaseProjection(): void;
    releaseReceipt(): void;
    switchOwner(): void;
  };
};
const snapshot = (page: Page) =>
  page.evaluate(() => (window as PulseWindow).__pulseFixture!.snapshot());
const writes = (value: Snapshot) =>
  value.requests.filter((request) => ['POST', 'PATCH'].includes(request.method));
const failures = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, browser }, info) => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(process.env.MINION_CRITICAL_OUT!, 'manifest.json'), 'utf8'),
  ) as { files: { path: string }[] };
  const allowed = new Set(manifest.files.map((file) => '/' + file.path));
  const rejected: string[] = [];
  failures.set(page, rejected);
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
  page.on('pageerror', (error) => rejected.push(error.message));
  page.on('websocket', (socket) => rejected.push('Unexpected native WS ' + socket.url()));
  await info.attach('runtime-identity', {
    body: JSON.stringify({
      browser: browser.version(),
      project: info.project.name,
      viewport: info.project.use.viewport,
      auth: 'synthetic fixture; separate real PostgreSQL authorization tests',
    }),
    contentType: 'application/json',
  });
});
test.afterEach(async ({ page }, info) => {
  const state = await snapshot(page);
  await info.attach('pulse-rendered-state', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await info.attach('pulse-call-counts', {
    body: JSON.stringify(state),
    contentType: 'application/json',
  });
  await info.attach('network-boundary', {
    body: JSON.stringify({
      unexpectedNativeRequestsOrErrors: failures.get(page),
      unexpectedFixtureRequests: state.unexpected,
      transport: 'synthetic HTTP; actual page and mutation helper',
    }),
    contentType: 'application/json',
  });
  expect(state.requests.length).toBeLessThan(50);
  expect(failures.get(page)).toEqual([]);
  expect(state.unexpected).toEqual([]);
});
for (const locale of ['en', 'es']) {
  for (const action of ['approve', 'dismiss']) {
    test(`PULSE1 ${locale} notifications ${action} submits the rendered revision, conflicts, then refreshes before retry`, async ({
      page,
    }, info) => {
      await page.goto(`/pulse.html?surface=notifications&lang=${locale}&stale`);
      await expect(
        page.getByText(locale === 'es' ? 'Revisión 1' : 'Revision 1', { exact: true }),
      ).toBeVisible();
      const decision = page.getByRole('button', {
        name:
          action === 'approve'
            ? locale === 'es'
              ? 'Aprobar'
              : 'Approve'
            : locale === 'es'
              ? 'Descartar'
              : 'Dismiss',
        exact: true,
      });
      await decision.focus();
      await page.keyboard.press('Enter');
      await expect.poll(async () => writes(await snapshot(page)).length).toBe(1);
      expect(writes(await snapshot(page))[0].body?.expectedRevision).toBe(1);
      expect((await snapshot(page)).dispatches).toBe(0);
      await expect(decision).toBeDisabled();
      await info.attach('pulse-conflict-state', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      const reload = page.getByRole('button', {
        name: locale === 'es' ? 'Recargar datos' : 'Reload current data',
        exact: true,
      });
      await reload.focus();
      await page.keyboard.press('Enter');
      await expect(
        page.getByText(locale === 'es' ? 'Revisión 2' : 'Revision 2', { exact: true }),
      ).toBeVisible();
      await expect(decision).toBeEnabled();
      await decision.focus();
      await page.keyboard.press('Enter');
      await expect.poll(async () => writes(await snapshot(page)).length).toBe(2);
      expect(writes(await snapshot(page))[1].body?.expectedRevision).toBe(2);
      expect((await snapshot(page)).decision).toBe(action === 'approve' ? 'approved' : 'dismissed');
    });
    test(`PULSE2 ${locale} notifications ${action} retains committed receipt after failed invalidation and reconnects without replay`, async ({
      page,
    }, info) => {
      await page.goto(`/pulse.html?surface=notifications&lang=${locale}&refresh-fail`);
      const decision = page.getByRole('button', {
        name:
          action === 'approve'
            ? locale === 'es'
              ? 'Aprobar'
              : 'Approve'
            : locale === 'es'
              ? 'Descartar'
              : 'Dismiss',
        exact: true,
      });
      await decision.focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('[data-pulse-receipt]')).toBeVisible();
      await expect(decision).toBeDisabled();
      await info.attach('pulse-committed-refresh-failure', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      expect(writes(await snapshot(page))).toHaveLength(1);
      await page.evaluate(() => (window as PulseWindow).__pulseFixture!.recover());
      await page
        .getByRole('button', {
          name: locale === 'es' ? 'Recargar datos' : 'Reload current data',
          exact: true,
        })
        .press('Enter');
      await page.evaluate(() => (window as PulseWindow).__pulseFixture!.reconnect());
      await expect(page.locator('[data-pulse-receipt]')).toBeVisible();
      expect(writes(await snapshot(page))).toHaveLength(1);
    });
  }
  for (const surface of ['page', 'popup']) {
    test(`PULSE3 ${locale} ${surface} uses real approval controls and reads scheduled receipt on reconnect`, async ({
      page,
    }, info) => {
      await page.goto(`/pulse.html?surface=${surface}&lang=${locale}`);
      const approve = page.getByRole('button', {
        name: locale === 'es' ? 'Aprobar' : 'Approve',
        exact: true,
      });
      await expect(approve).toBeVisible();
      await page.evaluate(() => (window as PulseWindow).__pulseFixture!.holdProjectionRead());
      await expect.poll(async () => (await snapshot(page)).heldProjection).toBe(2);
      await approve.focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('[data-pulse-receipt]')).toBeVisible();
      expect(writes(await snapshot(page))).toHaveLength(1);
      await expect.poll(async () => (await snapshot(page)).client.busy).toBe(false);
      await page.evaluate(() => (window as PulseWindow).__pulseFixture!.releaseProjection());
      await expect.poll(async () => (await snapshot(page)).heldProjection).toBe(0);
      await expect.poll(async () => (await snapshot(page)).client.itemCount).toBe(0);
      expect((await snapshot(page)).client.pendingCount).toBe(0);
      expect((await snapshot(page)).client.error).toBeNull();
      await expect(approve).toHaveCount(0);
      await page.evaluate(async () => {
        (window as PulseWindow).__pulseFixture!.holdNextReceipt();
        await (window as PulseWindow).__pulseFixture!.startReceiptRead();
      });
      await expect.poll(async () => (await snapshot(page)).heldReceipt).toBe(true);
      await page.evaluate(async () => {
        (window as PulseWindow).__pulseFixture!.scheduled();
        await (window as PulseWindow).__pulseFixture!.reconnect();
      });
      await expect(
        page.getByText(
          locale === 'es'
            ? 'Programado; ejecución sin verificar'
            : 'Scheduled; execution unverified',
          { exact: true },
        ),
      ).toBeVisible();
      await page.evaluate(() => (window as PulseWindow).__pulseFixture!.releaseReceipt());
      await expect.poll(async () => (await snapshot(page)).heldReceipt).toBe(false);
      expect((await snapshot(page)).client.receiptState).toBe('scheduled');
      expect(writes(await snapshot(page))).toHaveLength(1);
      if (surface === 'popup') {
        expect((await snapshot(page)).requests.length).toBeLessThan(30);
        await page.evaluate(async () => {
          (window as PulseWindow).__pulseFixture!.holdNextReceipt();
          await (window as PulseWindow).__pulseFixture!.reconnect();
        });
        await expect.poll(async () => (await snapshot(page)).heldReceipt).toBe(true);
        await page.evaluate(() => (window as PulseWindow).__pulseFixture!.switchOwner());
        await expect(page.locator('[data-pulse-receipt]')).toHaveCount(0);
        await page.evaluate(() => (window as PulseWindow).__pulseFixture!.releaseReceipt());
        await expect.poll(async () => (await snapshot(page)).heldReceipt).toBe(false);
        await page.evaluate(() => (window as PulseWindow).__pulseFixture!.reconnect());
        await expect(page.locator('[data-pulse-receipt]')).toHaveCount(0);
        const switched = await snapshot(page);
        expect(
          switched.requests
            .slice(switched.scopeSwitchAt ?? 0)
            .filter((request) => request.path.endsWith('/receipt')),
        ).toHaveLength(0);
        expect(writes(switched)).toHaveLength(1);
        expect(switched.requests.length).toBeLessThan(40);
      }
    });
  }
}
for (const locale of ['en', 'es']) {
  test(`PULSE4 ${locale} notifications recovers an unknown committed transport using reads only`, async ({
    page,
  }, info) => {
    await page.goto(`/pulse.html?surface=notifications&lang=${locale}&unknown`);
    await page
      .getByRole('button', { name: locale === 'es' ? 'Aprobar' : 'Approve', exact: true })
      .press('Enter');
    await expect.poll(async () => writes(await snapshot(page)).length).toBe(1);
    await page
      .getByRole('button', {
        name: locale === 'es' ? 'Recargar datos' : 'Reload current data',
        exact: true,
      })
      .press('Enter');
    await expect(page.locator('[data-pulse-receipt]')).toBeVisible();
    expect(writes(await snapshot(page))).toHaveLength(1);
    expect(
      (await snapshot(page)).requests.some((request) => request.path.endsWith('/receipt')),
    ).toBe(true);
  });
  test(`PULSE5 ${locale} page retains the editable draft after known save rejection`, async ({
    page,
  }, info) => {
    await page.goto(`/pulse.html?surface=page&lang=${locale}&write-fail`);
    await page
      .getByRole('button', { name: locale === 'es' ? 'Editar' : 'Edit', exact: true })
      .press('Enter');
    const draft = page.getByRole('textbox', { name: locale === 'es' ? 'Argumentos' : 'Arguments' });
    await draft.fill('{"title":"Retained draft"}');
    await page
      .getByRole('button', { name: locale === 'es' ? 'Guardar' : 'Save', exact: true })
      .press('Enter');
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(draft).toHaveValue('{"title":"Retained draft"}');
    expect(writes(await snapshot(page))).toHaveLength(1);
  });
}

for (const locale of ['en', 'es']) {
  test(`PULSE6 ${locale} notifications hides other-owner content and rejects receipt readback`, async ({
    page,
  }, info) => {
    await page.goto(`/pulse.html?surface=notifications&lang=${locale}&other-owner`);
    await expect(page.getByText('Pulse reviewed calendar action', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => (window as PulseWindow).__pulseFixture!.readDenied())).toBe(
      true,
    );
    expect(writes(await snapshot(page))).toHaveLength(0);
  });
}

for (const locale of ['en', 'es']) {
  const saveName = locale === 'es' ? 'Guardar comentario' : 'Save feedback';
  const commentName = locale === 'es' ? 'Comentario (opcional)' : 'Comment (optional)';
  const reasonName = locale === 'es' ? 'Motivo' : 'Reason';
  const reloadName = locale === 'es' ? 'Recargar datos' : 'Reload current data';
  test(`DIGEST1 ${locale} page preserves keyboard feedback after failed save`, async ({ page }) => {
    await page.goto(
      `/pulse.html?surface=page&digest&lang=${locale}&feedback-write-fail&digest-malicious-summary`,
    );
    await expect(page.locator('img[src*="attacker.invalid"]')).toHaveCount(0);
    const save = page.getByRole('button', { name: saveName, exact: true });
    await expect(save).toBeEnabled();
    await page.getByRole('combobox', { name: reasonName, exact: true }).selectOption('fact_error');
    await page
      .getByRole('textbox', { name: commentName, exact: true })
      .fill('Retain this factual correction.');
    await save.press('Enter');
    await expect(page.getByRole('textbox', { name: commentName, exact: true })).toHaveValue(
      'Retain this factual correction.',
    );
    await expect(page.getByRole('combobox', { name: reasonName, exact: true })).toHaveValue(
      'fact_error',
    );
    expect(writes(await snapshot(page))).toHaveLength(1);
    expect((await snapshot(page)).feedbackCount).toBe(0);
    await expect(page.getByRole('link', { name: 'ai · 7.0.18', exact: true })).toHaveAttribute(
      'href',
      'https://github.com/vercel/ai/releases/tag/ai%407.0.18',
    );
  });
  for (const mode of ['refresh-fail', 'unknown']) {
    test(`${mode === 'refresh-fail' ? 'DIGEST2' : 'DIGEST3'} ${locale} page reconciles ${mode === 'refresh-fail' ? 'committed feedback refresh with one write' : 'unknown feedback using reads only'}`, async ({
      page,
    }) => {
      await page.goto(`/pulse.html?surface=page&digest&lang=${locale}&feedback-${mode}`);
      const save = page.getByRole('button', { name: saveName, exact: true });
      await expect(save).toBeEnabled();
      await page
        .getByRole('textbox', { name: commentName, exact: true })
        .fill('One durable feedback action.');
      await save.press('Enter');
      const reload = page.getByRole('button', { name: reloadName, exact: true });
      await expect(reload).toBeVisible();
      expect(writes(await snapshot(page))).toHaveLength(1);
      expect((await snapshot(page)).feedbackCount).toBe(1);
      await page.evaluate(() => (window as PulseWindow).__pulseFixture!.recover());
      await reload.press('Enter');
      await expect(reload).toHaveCount(0);
      await expect(
        page.getByRole('button', {
          name: locale === 'es' ? 'Guardar corrección' : 'Save correction',
          exact: true,
        }),
      ).toBeEnabled();
      await page.evaluate(() => (window as PulseWindow).__pulseFixture!.reconnect());
      expect(writes(await snapshot(page))).toHaveLength(1);
    });
  }
  test(`DIGEST4 ${locale} page hides other-owner digest and preserves owner freshness`, async ({
    page,
  }) => {
    await page.goto(`/pulse.html?surface=page&digest&lang=${locale}&other-owner`);
    await expect(page.locator('[data-pulse-feedback]')).toHaveCount(0);
    expect(writes(await snapshot(page))).toHaveLength(0);
    await page.goto(`/pulse.html?surface=page&digest&lang=${locale}`);
    await expect(page.getByRole('button', { name: saveName, exact: true })).toBeEnabled();
    await page
      .getByRole('textbox', { name: commentName, exact: true })
      .fill('Private unsent owner draft.');
    await page.evaluate(() => (window as PulseWindow).__pulseFixture!.switchOwner());
    await expect(page.getByRole('textbox', { name: commentName, exact: true })).toHaveCount(0);
    expect(writes(await snapshot(page))).toHaveLength(0);
  });
}

for (const locale of ['en', 'es']) {
  test(`DIGEST5 ${locale} page reconnects one actual scheduled SQL card without producing a write`, async ({
    page,
  }, info) => {
    const produced = JSON.parse(
      fs.readFileSync('tests/fixtures/critical-journeys/scheduled-proposal.json', 'utf8'),
    );
    await page.goto(`/pulse.html?surface=page&scheduled&lang=${locale}`);
    await expect(page.getByRole('heading', { name: produced.title, exact: true })).toHaveCount(1);
    await expect(page.locator('[data-pulse-feedback]')).toHaveAttribute(
      'data-pulse-feedback',
      produced.id,
    );
    await page.evaluate(() => (window as PulseWindow).__pulseFixture!.reconnect());
    await expect(page.getByRole('heading', { name: produced.title, exact: true })).toHaveCount(1);
    expect(writes(await snapshot(page))).toHaveLength(0);
    await info.attach('actual-scheduled-card-projection', {
      body: JSON.stringify({
        source: 'actual selected scheduler SQL plus owner-scoped listPending read',
        cardId: produced.id,
        kind: produced.kind,
        payload: produced.payload,
        transport:
          'immutable actual-service projection rendered in the current production component fixture',
      }),
      contentType: 'application/json',
    });
  });
}
