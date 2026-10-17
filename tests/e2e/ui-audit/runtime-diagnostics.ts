import type { Page } from '@playwright/test';

export interface RuntimeUiDiagnostics {
  documentOverflowPx: number;
  /** `data-allow-document-overflow="true"` on body or the page shell. */
  documentOverflowAllowed: boolean;
  duplicateIds: string[];
  unnamedInteractiveElements: string[];
  unnamedDialogs: string[];
  buttonsMissingTypeInForms: string[];
  invalidLocalLinks: string[];
  visibleRouteTitles: string[];
  /** Visible controls below the minimum, excluding `[data-dense]` subtrees (spec 014). */
  undersizedInteractiveElements: string[];
  /** Each visible `[data-dense]` region named by its nearest `data-component`/`data-part`. */
  denseRegions: string[];
  /** `data-archetype` of the rendered `[data-part="page-shell"]`, null when none rendered. */
  pageShellArchetype: string | null;
  /** Sorted unique `data-component` and `data-part` values present in the document. */
  landmarks: string[];
  /** Primary-variant buttons inside the page header's `primary-actions` part. */
  primaryHeaderActions: string[];
  formRendered: boolean;
}

export interface RuntimeUiDiagnosticOptions {
  minimumInteractiveTargetPx?: number;
  enforceInteractiveTargetSize?: boolean;
  requireSingleVisibleTitle?: boolean;
}

/**
 * Browser-side body of the diagnostics. Self-contained on purpose: Playwright
 * serialises it into the page, and the vitest happy-dom lane calls it directly.
 */
export const runtimeUiDiagnosticsInBrowser = (
  diagnosticOptions: RuntimeUiDiagnosticOptions,
): RuntimeUiDiagnostics => {
  const visible = (element: Element): element is HTMLElement => {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      rect.width > 0 &&
      rect.height > 0
    );
  };

  const selectorFor = (element: Element): string => {
    if (element.id) return `#${CSS.escape(element.id)}`;
    const testId = element.getAttribute('data-testid');
    if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
    const role = element.getAttribute('role');
    const name = element.getAttribute('aria-label') || element.getAttribute('name');
    const qualifier = role ? `[role="${role}"]` : name ? `[name="${CSS.escape(name)}"]` : '';
    let index = 1;
    for (
      let sibling = element.previousElementSibling;
      sibling;
      sibling = sibling.previousElementSibling
    ) {
      if (sibling.tagName === element.tagName) index += 1;
    }
    return `${element.tagName.toLowerCase()}${qualifier}:nth-of-type(${index})`;
  };

  const referencedText = (element: Element, attribute: 'aria-labelledby' | 'aria-describedby') =>
    (element.getAttribute(attribute) ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
      .join(' ')
      .trim();

  const associatedLabel = (element: Element): string => {
    if (!(
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement
    )) {
      return '';
    }
    return Array.from(element.labels ?? [])
      .map((label) => label.textContent?.trim() ?? '')
      .join(' ')
      .trim();
  };

  const accessibleName = (element: Element): string => {
    const direct =
      element.getAttribute('aria-label')?.trim() ||
      referencedText(element, 'aria-labelledby') ||
      associatedLabel(element) ||
      element.getAttribute('alt')?.trim() ||
      element.getAttribute('title')?.trim() ||
      element.textContent?.trim();
    return direct ?? '';
  };

  const ids = [...document.querySelectorAll<HTMLElement>('[id]')].map((element) => element.id);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))].sort();

  const interactiveSelector = [
    'button',
    'a[href]',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="switch"]',
    '[role="tab"]',
    '[role="menuitem"]',
  ].join(',');
  const interactive = [...document.querySelectorAll(interactiveSelector)].filter(visible);
  const unnamedInteractiveElements = interactive
    .filter((element) => accessibleName(element).length === 0)
    .map(selectorFor);
  const unnamedDialogs = [...document.querySelectorAll('[role="dialog"], dialog[open]')]
    .filter(visible)
    .filter((element) => accessibleName(element).length === 0)
    .map(selectorFor);
  const buttonsMissingTypeInForms = [...document.querySelectorAll('form button:not([type])')]
    .filter(visible)
    .map(selectorFor);
  const invalidLocalLinks = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
    .filter(visible)
    .filter((anchor) => {
      const raw = anchor.getAttribute('href')?.trim() ?? '';
      if (!raw || raw === '#') return true;
      try {
        const destination = new URL(raw, location.href);
        return destination.origin === location.origin && destination.pathname.length === 0;
      } catch {
        return true;
      }
    })
    .map(selectorFor);
  const visibleRouteTitles = [...document.querySelectorAll('h1, [data-page-title]')]
    .filter(visible)
    .map((element) => element.textContent?.trim() ?? '')
    .filter(Boolean);
  const undersizedInteractiveElements = interactive
    .filter((element) => !element.closest('[data-dense]'))
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      const minimum = diagnosticOptions.minimumInteractiveTargetPx ?? 24;
      return rect.width < minimum || rect.height < minimum;
    })
    .map(selectorFor);
  const regionName = (region: Element): string => {
    const owner = region.closest('[data-component], [data-part]');
    return (
      owner?.getAttribute('data-component') ??
      owner?.getAttribute('data-part') ??
      selectorFor(region)
    );
  };
  const denseRegions = [
    ...new Set([...document.querySelectorAll('[data-dense]')].filter(visible).map(regionName)),
  ].sort();

  const pageShell = document.querySelector('[data-part="page-shell"]');
  const landmarks = [
    ...new Set(
      [...document.querySelectorAll('[data-component], [data-part]')].flatMap((element) =>
        [element.getAttribute('data-component'), element.getAttribute('data-part')].filter(
          (value): value is string => Boolean(value),
        ),
      ),
    ),
  ].sort();
  const primaryHeaderActions = [
    ...document.querySelectorAll(
      '[data-part="page-header"] [data-part="primary-actions"] [data-variant="primary"]',
    ),
  ]
    .filter(visible)
    .map(selectorFor);

  const documentElement = document.documentElement;
  return {
    documentOverflowPx: Math.max(0, documentElement.scrollWidth - documentElement.clientWidth),
    documentOverflowAllowed:
      document.body.matches('[data-allow-document-overflow="true"]') ||
      pageShell?.getAttribute('data-allow-document-overflow') === 'true',
    duplicateIds,
    unnamedInteractiveElements,
    unnamedDialogs,
    buttonsMissingTypeInForms,
    invalidLocalLinks,
    visibleRouteTitles,
    undersizedInteractiveElements,
    denseRegions,
    pageShellArchetype: pageShell?.getAttribute('data-archetype') ?? null,
    landmarks,
    primaryHeaderActions,
    formRendered: document.querySelector('form') !== null,
  };
};

/**
 * Runtime invariants that static route/API contracts cannot prove. Selectors are
 * returned instead of element handles so the machine-readable capture explains
 * exactly which rendered control failed.
 */
export async function collectRuntimeUiDiagnostics(
  page: Page,
  options: RuntimeUiDiagnosticOptions = {},
): Promise<RuntimeUiDiagnostics> {
  return page.evaluate(runtimeUiDiagnosticsInBrowser, options);
}

export function assertCriticalRuntimeDiagnostics(
  diagnostics: RuntimeUiDiagnostics,
  routeId: string,
  options: RuntimeUiDiagnosticOptions = {},
): void {
  const failures: string[] = [];
  if (diagnostics.documentOverflowPx > 1 && !diagnostics.documentOverflowAllowed) {
    failures.push(`document overflow ${diagnostics.documentOverflowPx}px`);
  }
  if (diagnostics.duplicateIds.length > 0) {
    failures.push(`duplicate IDs: ${diagnostics.duplicateIds.join(', ')}`);
  }
  if (diagnostics.unnamedInteractiveElements.length > 0) {
    failures.push(`unnamed controls: ${diagnostics.unnamedInteractiveElements.join(', ')}`);
  }
  if (diagnostics.unnamedDialogs.length > 0) {
    failures.push(`unnamed dialogs: ${diagnostics.unnamedDialogs.join(', ')}`);
  }
  if (diagnostics.buttonsMissingTypeInForms.length > 0) {
    failures.push(`form buttons missing type: ${diagnostics.buttonsMissingTypeInForms.join(', ')}`);
  }
  if (diagnostics.invalidLocalLinks.length > 0) {
    failures.push(`invalid local links: ${diagnostics.invalidLocalLinks.join(', ')}`);
  }
  if (options.requireSingleVisibleTitle && diagnostics.visibleRouteTitles.length !== 1) {
    failures.push(
      `expected one visible route title, found ${diagnostics.visibleRouteTitles.length}: ${diagnostics.visibleRouteTitles.join(' | ') || '(none)'}`,
    );
  }
  if (
    options.enforceInteractiveTargetSize &&
    diagnostics.undersizedInteractiveElements.length > 0
  ) {
    failures.push(
      `interactive targets below ${options.minimumInteractiveTargetPx ?? 24}px: ${diagnostics.undersizedInteractiveElements.join(', ')}`,
    );
  }
  if (failures.length > 0) throw new Error(`${routeId}: ${failures.join('; ')}`);
}
