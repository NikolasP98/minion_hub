import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const CASES = [
  ['DS1 prototype attributes', 'prototype attributes'],
  ['DS2 editor paste and Markdown', 'editor paste and Markdown'],
  ['DS3 ordinary sanitizer', 'ordinary sanitizer'],
  ['DS4 detached sanitizer subtree', 'detached sanitizer subtree'],
] as const;

type CheckName = (typeof CASES)[number][1];
type Mutation = 'none' | 'editor-paste' | 'ordinary-sanitizer';
type CheckResult =
  | { name: CheckName; mutation: Mutation; passed: true }
  | {
      name: CheckName;
      mutation: Mutation;
      passed: false;
      failure:
        | { kind: 'fixture-invariant'; invariant: string }
        | { kind: 'unexpected-error'; detail: string };
    };
type FixtureWindow = Window & {
  __dependencySecurity: {
    names: readonly CheckName[];
    run(name: CheckName): CheckResult;
  };
};

const violations = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page, browser }, info) => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(process.env.MINION_DEPENDENCY_OUT!, 'manifest.json'), 'utf8'),
  ) as { files: { path: string }[] };
  const allowed = new Set(manifest.files.map((file) => `/${file.path}`));
  const rejected: string[] = [];
  violations.set(page, rejected);
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      url.origin === 'http://127.0.0.1:18904' &&
      allowed.has(url.pathname === '/' ? '/index.html' : url.pathname) &&
      request.method() === 'GET'
    ) {
      await route.continue();
      return;
    }
    rejected.push(`${request.method()} ${request.url()}`);
    await route.abort('blockedbyclient');
  });
  page.on('websocket', (socket) => rejected.push(`WebSocket ${socket.url()}`));
  page.on('pageerror', (error) => rejected.push(`pageerror ${error.message}`));
  await info.attach('runtime-identity', {
    body: JSON.stringify({ browser: browser.version(), project: info.project.name, auth: 'none' }),
    contentType: 'application/json',
  });
});

test.afterEach(async ({ page }, info) => {
  const unexpected = violations.get(page) ?? [];
  await info.attach('network-boundary', {
    body: JSON.stringify({ allowedOrigin: 'http://127.0.0.1:18904', unexpected }),
    contentType: 'application/json',
  });
  expect(unexpected).toEqual([]);
});

for (const [title, check] of CASES) {
  test(title, async ({ page }, info) => {
    await page.goto('/index.html');
    await expect(page.getByRole('heading', { name: 'Dependency security fixture' })).toBeVisible();
    const names = await page.evaluate(() => (window as FixtureWindow).__dependencySecurity.names);
    expect(names).toEqual(CASES.map((entry) => entry[1]));
    const result = await page.evaluate(
      (name) => (window as FixtureWindow).__dependencySecurity.run(name),
      check,
    );
    await info.attach('check-result', {
      body: JSON.stringify(result),
      contentType: 'application/json',
    });
    if (!result.passed) {
      const signal =
        result.failure.kind === 'fixture-invariant'
          ? `DEPENDENCY_SECURITY_FIXTURE_INVARIANT:${result.failure.invariant}`
          : `DEPENDENCY_SECURITY_FIXTURE_UNEXPECTED:${result.failure.detail}`;
      throw new Error(signal);
    }
    expect(result).toEqual({
      name: check,
      mutation: (process.env.MINION_DEPENDENCY_MUTATION ?? 'none') as Mutation,
      passed: true,
    });
    await expect(page.locator('#result')).toHaveText(`passed: ${check}`);
  });
}
