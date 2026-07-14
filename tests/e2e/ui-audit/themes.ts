import type { Page } from '@playwright/test';

export const AUDIT_THEMES = {
  dark: { presetId: 'new-york', accentId: 'blue' },
  light: { presetId: 'github-light', accentId: 'blue' },
  crt: { presetId: 'crt', accentId: 'amber' },
  voxelized: { presetId: 'voxelized', accentId: 'cyan' },
} as const;

export type AuditThemeId = keyof typeof AUDIT_THEMES;
export type AuditThemePreference = { presetId: string; accentId: string };

export function resolveAuditTheme(value: string | undefined) {
  if (!value) return undefined;
  if (!(value in AUDIT_THEMES)) {
    throw new Error(
      `Unknown E2E_UI_AUDIT_THEME=${value}. Expected ${Object.keys(AUDIT_THEMES).join(', ')}.`,
    );
  }
  return { id: value as AuditThemeId, ...AUDIT_THEMES[value as AuditThemeId] };
}

async function writeTheme(page: Page, preference: AuditThemePreference): Promise<void> {
  const endpoint = new URL('/api/me/preferences/theme', page.url()).toString();
  const response = await page.request.put(endpoint, { data: { value: preference } });
  if (!response.ok()) {
    throw new Error(`Theme preparation failed: ${response.status()} ${await response.text()}`);
  }
  await page.evaluate((value) => {
    localStorage.setItem('minion-hub-theme', JSON.stringify(value));
  }, preference);
}

export async function prepareAuditTheme(
  page: Page,
  theme: ReturnType<typeof resolveAuditTheme>,
): Promise<AuditThemePreference | undefined> {
  if (!theme) return undefined;
  const endpoint = new URL('/api/me/preferences', page.url()).toString();
  const response = await page.request.get(endpoint);
  if (!response.ok()) {
    throw new Error(`Theme snapshot failed: ${response.status()} ${await response.text()}`);
  }
  const body = (await response.json()) as { preferences?: { theme?: unknown } };
  const previous = body.preferences?.theme;
  const previousTheme =
    previous &&
    typeof previous === 'object' &&
    typeof (previous as AuditThemePreference).presetId === 'string' &&
    typeof (previous as AuditThemePreference).accentId === 'string'
      ? (previous as AuditThemePreference)
      : undefined;
  await writeTheme(page, theme);
  await page.reload({ waitUntil: 'networkidle' });
  return previousTheme;
}

export async function prepareAnonymousAuditTheme(
  page: Page,
  theme: ReturnType<typeof resolveAuditTheme>,
): Promise<void> {
  if (!theme) return;
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.evaluate((value) => {
    localStorage.setItem('minion-hub-theme', JSON.stringify(value));
  }, theme);
}

export async function restoreAuditTheme(
  page: Page,
  previous: AuditThemePreference | undefined,
): Promise<void> {
  await writeTheme(page, previous ?? AUDIT_THEMES.dark);
}
