/**
 * Synced pages S1 (spec 150): a filter in the filter bar moves exactly the blocks
 * connected to it, and their numbers match a hand-written query with the same
 * condition (SC-002); a change shows on screen within 2 s, median of 5 (SC-001).
 * Runs against the QA stack. Every element it creates is removed in `finally`
 * (reversible writes), so it can be re-run.
 *
 * TODO(handoff): written for spec 150 S1 but NOT executed in the authoring
 * environment (no QA stack there) — run it once on the QA stack before merging
 * and fix selectors if the seeded data differs (pointer: spec 150 T020).
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_OWNER_EMAIL;
const PASSWORD = process.env.E2E_OWNER_PASSWORD;

test.skip(!EMAIL || !PASSWORD, 'Set E2E_OWNER_EMAIL / E2E_OWNER_PASSWORD to run this spec.');
// Block windows are computed in the browser's local day; pin it so the test can mirror them.
test.use({ timezoneId: 'UTC' });

const DAY = 86_400_000;

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.locator('#login-identifier').fill(EMAIL!);
  await page.locator('#login-password').fill(PASSWORD!);
  await page.locator('button[type=submit]').first().click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 });
}

/** Mirrors `periodWindow('last_30d' | 'last_7d')` in UTC: `[today - (n-1) days, tomorrow)`. */
function lastDays(n: number) {
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return {
    from: new Date(today - (n - 1) * DAY).toISOString(),
    to: new Date(today + DAY).toISOString(),
  };
}

type Where = Array<{ col: string; op: string; value: unknown }>;

/** The expected number, from a direct query written here, independent of `blockQueries`. */
async function count(request: APIRequestContext, dataset: string, where: Where = []) {
  const res = await request.post('/api/sandbox/query', {
    data: { dataset, where, aggregate: [{ fn: 'count', col: '*', as: 'value' }] },
  });
  expect(res.ok()).toBe(true);
  return Number(((await res.json()) as { rows: Array<{ value: number }> }).rows[0]?.value ?? 0);
}

const kpi = (dataset: string, extra: Record<string, unknown> = {}) => ({
  v: 1,
  type: 'kpi',
  source: { dataset, metric: { fn: 'count', col: '*' } },
  format: 'number',
  ...extra,
});

async function create(request: APIRequestContext, title: string, spec: unknown) {
  const res = await request.post('/api/sandbox/elements', { data: { title, spec } });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { element: { id: string } }).element.id;
}

const digits = (text: string | null) => Number((text ?? '').replace(/[^\d]/g, ''));
const block = (page: Page, title: string) => page.locator('section.element', { hasText: title });
const valueOf = (page: Page, title: string) =>
  block(page, title).locator('[data-block-kind="kpi"]');

test.describe('synced pages S1', () => {
  const ids: string[] = [];

  test.afterEach(async ({ request }) => {
    for (const id of ids.splice(0)) await request.delete(`/api/sandbox/elements/${id}`);
  });

  test('a date filter moves the connected blocks and only those (US1)', async ({
    page,
    request,
  }) => {
    await login(page);
    const wired = [{ var: 'period', col: 'submitted_at' }];
    ids.push(
      await create(request, 'E2E Period', {
        v: 1,
        type: 'filter',
        var: 'period',
        control: 'date_range',
      }),
      await create(request, 'E2E A tickets', kpi('pos.tickets', { listens: wired })),
      await create(
        request,
        'E2E B own range',
        kpi('pos.tickets', {
          listens: wired,
          source: {
            dataset: 'pos.tickets',
            metric: { fn: 'count', col: '*' },
            period: { col: 'submitted_at', range: 'this_year' },
          },
        }),
      ),
      await create(request, 'E2E C not connected', kpi('pos.tickets')),
    );
    await page.goto('/sandbox', { waitUntil: 'networkidle' });
    const untouched = digits(await valueOf(page, 'E2E C not connected').textContent());

    const queries: string[] = [];
    page.on('request', (r) => {
      if (r.url().endsWith('/api/sandbox/query')) queries.push(r.postData() ?? '');
    });
    await page.getByRole('button', { name: /E2E Period/ }).click();
    await page.getByRole('menuitem', { name: 'Last 30 days' }).click();

    const { from, to } = lastDays(30);
    const expected = await count(request, 'pos.tickets', [
      { col: 'submitted_at', op: 'gte', value: from },
      { col: 'submitted_at', op: 'lt', value: to },
    ]);
    await expect(valueOf(page, 'E2E A tickets')).toContainText(String(expected));
    await expect(valueOf(page, 'E2E B own range')).toContainText(String(expected));
    // exactly the two connected blocks reloaded; the third did not
    expect(queries).toHaveLength(2);
    expect(digits(await valueOf(page, 'E2E C not connected').textContent())).toBe(untouched);

    // Clearing brings back what the blocks show without the filter.
    await page.getByRole('button', { name: 'Clear value' }).click();
    await expect(valueOf(page, 'E2E A tickets')).toContainText(
      String(await count(request, 'pos.tickets')),
    );
  });

  test('single and multi pickers narrow the page (US2)', async ({ page, request }) => {
    await login(page);
    ids.push(
      await create(request, 'E2E Status', {
        v: 1,
        type: 'filter',
        var: 'status',
        control: 'multi_select',
        options: { dataset: 'pos.tickets', col: 'status' },
      }),
      await create(
        request,
        'E2E By status',
        kpi('pos.tickets', { listens: [{ var: 'status', col: 'status' }] }),
      ),
    );
    await page.goto('/sandbox', { waitUntil: 'networkidle' });
    await page.getByText('E2E Status').first().click();
    const options = page.getByRole('option');
    await expect(options.nth(1)).toBeVisible();
    const picks = Math.min(2, (await options.count()) - 1);
    test.skip(picks < 1, 'No ticket statuses seeded.');
    const chosen: string[] = [];
    for (let i = 1; i <= picks; i++) {
      const label = (await options.nth(i).textContent()) ?? '';
      chosen.push(label.replace(/\s*\d+\s*$/, '').trim());
      await options.nth(i).click();
    }
    const expected = await count(request, 'pos.tickets', [
      { col: 'status', op: 'in', value: chosen },
    ]);
    await expect(valueOf(page, 'E2E By status')).toContainText(String(expected));
  });

  test('a filter change shows on screen within 2 s (median of 5, SC-001)', async ({
    page,
    request,
  }) => {
    await login(page);
    ids.push(
      await create(request, 'E2E Period', {
        v: 1,
        type: 'filter',
        var: 'period',
        control: 'date_range',
      }),
      await create(
        request,
        'E2E Timed',
        kpi('pos.tickets', { listens: [{ var: 'period', col: 'submitted_at' }] }),
      ),
    );
    await page.goto('/sandbox', { waitUntil: 'networkidle' });
    const ranges: Array<[string, number]> = [
      ['Last 7 days', 7],
      ['Last 30 days', 30],
    ];
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const [label, days] = ranges[i % 2];
      const { from, to } = lastDays(days);
      const expected = await count(request, 'pos.tickets', [
        { col: 'submitted_at', op: 'gte', value: from },
        { col: 'submitted_at', op: 'lt', value: to },
      ]);
      const started = Date.now();
      await page.getByRole('button', { name: /E2E Period/ }).click();
      await page.getByRole('menuitem', { name: label }).click();
      await expect(valueOf(page, 'E2E Timed')).toContainText(String(expected), {
        timeout: 5_000,
      });
      samples.push(Date.now() - started);
    }
    samples.sort((a, b) => a - b);
    expect(samples[2]).toBeLessThan(2_000);
  });
});
