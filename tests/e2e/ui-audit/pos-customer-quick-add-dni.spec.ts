/**
 * POS "New client" form — typing a full DNI must not collapse the document
 * number input (owner recording 2026-09-30: the inline "Autofill from DNI"
 * text button ate the shared grid cell). Runs against the QA stack.
 */
import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_OWNER_EMAIL;
const PASSWORD = process.env.E2E_OWNER_PASSWORD;

test.skip(!EMAIL || !PASSWORD, 'Set E2E_OWNER_EMAIL / E2E_OWNER_PASSWORD to run this spec.');

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.locator('#login-identifier').fill(EMAIL!);
  await page.locator('#login-password').fill(PASSWORD!);
  await page.locator('button[type=submit]').first().click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 });
}

test('document number input keeps its width once a DNI is typed', async ({ page }) => {
  await login(page);
  await page.goto('/pos/sell', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Select client' }).click();
  await page.getByRole('button', { name: 'Quick add' }).click();

  const form = page.locator('form.quick-add');
  await expect(form).toBeVisible({ timeout: 30_000 });
  const input = form.getByLabel('Document number');
  const before = (await input.boundingBox())!;

  await input.fill('60525678');
  const autofill = form.getByRole('button', { name: 'Autofill from DNI' });
  await expect(autofill).toBeVisible();
  // Icon-only: the label lives in aria-label + tooltip, not in the row.
  await expect(autofill).toHaveText('');

  const after = (await input.boundingBox())!;
  // The input gives up only the icon control + gap, never collapses.
  expect(after.width).toBeGreaterThan(before.width * 0.6);
  expect(after.width).toBeGreaterThan(80);
});
