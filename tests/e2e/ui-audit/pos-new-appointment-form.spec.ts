/**
 * Owner feedback 2026-09-30: the "New appointment" tray create form
 * (`/pos/appointments`) renders picked services as a compact table (not
 * pills) with a per-user kebab to show/hide Duration/Price, and the CRM
 * customer picker moved to the top of the form as the primary field.
 */
import { test, expect, type Page } from '@playwright/test';

const EMAIL = 'tenancy.user.owner@qa.minion.test';
const PASSWORD = 'QaStack!2026';

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.locator('#login-identifier').fill(EMAIL);
  await page.locator('#login-password').fill(PASSWORD);
  await page.locator('button[type=submit]').first().click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 });
}

test.describe('POS new-appointment form — services table + customer-first', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('customer first, services table, kebab column toggle persists', async ({ page }) => {
    await page.goto('/pos/appointments', { waitUntil: 'load' });

    await page
      .getByRole('button', { name: 'New appointment', exact: true })
      .click({ timeout: 30_000 });
    const tray = page.getByRole('dialog').last();
    await expect(tray).toBeVisible({ timeout: 15_000 });

    // Customer section renders before the services section.
    const customerBox = tray.locator('.customer').first();
    const servicesBox = tray.locator('.svc-section').first();
    await expect(customerBox).toBeVisible();
    await expect(servicesBox).toBeVisible();
    const order = await tray.evaluate((el) => {
      const c = el.querySelector('.customer');
      const s = el.querySelector('.svc-section');
      if (!c || !s) return null;
      // eslint-disable-next-line no-bitwise
      return Boolean(c.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(order).toBe(true);

    await page.screenshot({
      path: '.tmp-screenshots/appt-form-0-services.png',
      fullPage: true,
    });

    // Pick two services from the shared multi-pick Picker.
    await servicesBox.getByRole('button', { name: /Add service/ }).click();
    const picker = page.getByRole('dialog').last();
    await expect(picker).toBeVisible({ timeout: 15_000 });
    const addRow = picker.getByRole('button', { name: 'Add this entry' });
    const rowCount = await addRow.count();
    test.skip(rowCount < 2, 'Fewer than 2 services seeded.');
    await addRow.first().click();
    await addRow.first().click();
    // The picker is a non-modal DraggableWindow (aria-modal="false"): Escape
    // bubbles to the outer native <dialog> Sheet and closes THAT instead, so
    // dismiss it via its own explicit close button.
    await picker.getByRole('button', { name: 'Close' }).click();

    const dataRows = servicesBox.locator('table tbody tr:not([aria-hidden="true"])');
    await expect(dataRows).toHaveCount(2, { timeout: 10_000 });

    await page.screenshot({
      path: '.tmp-screenshots/appt-form-3-services.png',
      fullPage: true,
    });

    // Open the kebab and hide Price.
    await servicesBox.getByRole('button', { name: 'Table columns' }).click();
    const menu = page.getByRole('menu').last();
    await expect(menu).toBeVisible({ timeout: 10_000 });
    await page.screenshot({
      path: '.tmp-screenshots/appt-form-kebab-open.png',
      fullPage: true,
    });
    await menu.getByRole('menuitem', { name: 'Price' }).click();
    await expect(servicesBox.locator('th', { hasText: 'Price' })).toHaveCount(0, {
      timeout: 10_000,
    });

    // Reload and reopen the tray: the hidden column stays hidden (persisted).
    await page.reload({ waitUntil: 'load' });
    await page
      .getByRole('button', { name: 'New appointment', exact: true })
      .click({ timeout: 30_000 });
    const tray2 = page.getByRole('dialog').last();
    await expect(tray2).toBeVisible({ timeout: 15_000 });
    await expect(tray2.locator('th', { hasText: 'Price' })).toHaveCount(0, { timeout: 10_000 });
  });
});
