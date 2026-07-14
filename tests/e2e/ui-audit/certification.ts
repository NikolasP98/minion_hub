import type { Page } from '@playwright/test';
import type { RouteArchetype } from '../../../src/lib/routes/route-design-manifest';
import type { CertificationEvidence } from './run-artifact';
import {
  assertCriticalRuntimeDiagnostics,
  collectRuntimeUiDiagnostics,
  type RuntimeUiDiagnosticOptions,
} from './runtime-diagnostics';

const TITLE_ARCHETYPES = new Set<RouteArchetype>([
  'dashboard',
  'collection',
  'record-detail',
  'form-settings',
  'master-detail',
  'public-auth',
]);

export function requiresSingleVisibleTitle(archetype: RouteArchetype): boolean {
  return TITLE_ARCHETYPES.has(archetype);
}

export function exactZoomViewport(
  viewport: { width: number; height: number },
  zoomPercent = 200,
): { width: number; height: number } {
  if (!Number.isFinite(zoomPercent) || zoomPercent <= 0) {
    throw new Error(`Invalid zoom percentage ${zoomPercent}.`);
  }
  const scale = zoomPercent / 100;
  return {
    width: Math.max(1, Math.floor(viewport.width / scale)),
    height: Math.max(1, Math.floor(viewport.height / scale)),
  };
}

export async function collectKeyboardTraversal(page: Page): Promise<{
  expected: string[];
  reached: string[];
  missed: string[];
  focusEscaped: boolean;
}> {
  const expected = await page.evaluate(() => {
    const visible = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0 &&
        !element.closest('[inert]')
      );
    };
    const selectorFor = (element: HTMLElement) => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const testId = element.dataset.testid;
      if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
      const segments: string[] = [];
      let current: HTMLElement | null = element;
      while (current && current !== document.body) {
        const siblings = [...(current.parentElement?.children ?? [])].filter(
          (candidate) => candidate.tagName === current?.tagName,
        );
        segments.unshift(
          `${current.tagName.toLowerCase()}:nth-of-type(${Math.max(1, siblings.indexOf(current) + 1)})`,
        );
        current = current.parentElement;
      }
      return `body > ${segments.join(' > ')}`;
    };
    const selector = [
      'a[href]',
      'button',
      'input:not([type="hidden"])',
      'select',
      'textarea',
      '[tabindex]',
    ].join(',');
    return [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((element) => visible(element) && element.tabIndex >= 0)
      .filter((element) => !('disabled' in element) || !(element as HTMLButtonElement).disabled)
      .map(selectorFor);
  });

  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  const reached: string[] = [];
  let focusEscaped = false;
  const maximumTabs = expected.length + 3;
  for (let index = 0; index < maximumTabs; index += 1) {
    await page.keyboard.press('Tab');
    const selector = await page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement) || element === document.body) return null;
      if (element.id) return `#${CSS.escape(element.id)}`;
      const testId = element.dataset.testid;
      if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
      const segments: string[] = [];
      let current: HTMLElement | null = element;
      while (current && current !== document.body) {
        const siblings = [...(current.parentElement?.children ?? [])].filter(
          (candidate) => candidate.tagName === current?.tagName,
        );
        segments.unshift(
          `${current.tagName.toLowerCase()}:nth-of-type(${Math.max(1, siblings.indexOf(current) + 1)})`,
        );
        current = current.parentElement;
      }
      return `body > ${segments.join(' > ')}`;
    });
    if (!selector) {
      focusEscaped = expected.length > 0;
      break;
    }
    if (reached.includes(selector)) break;
    reached.push(selector);
  }
  return {
    expected,
    reached,
    missed: expected.filter((selector) => !reached.includes(selector)),
    focusEscaped,
  };
}

export async function applyLongContentMode(page: Page): Promise<number> {
  return page.evaluate(() => {
    type AuditWindow = Window & {
      __uiAuditLongText?: Array<[Text, string]>;
      __uiAuditOriginalLang?: string;
    };
    const auditWindow = window as AuditWindow;
    if (auditWindow.__uiAuditLongText) return auditWindow.__uiAuditLongText.length;
    const textNodes: Array<[Text, string]> = [];
    const selectors = 'h1, h2, h3, [data-page-title], button, label, nav a, th, [role="tab"]';
    for (const root of document.querySelectorAll(selectors)) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const text = node as Text;
        const value = text.data.trim();
        if (value.length > 0 && value.length < 100) {
          textNodes.push([text, text.data]);
          text.data = `${text.data} — ${value} ${value}`;
        }
        node = walker.nextNode();
      }
    }
    auditWindow.__uiAuditLongText = textNodes;
    auditWindow.__uiAuditOriginalLang = document.documentElement.lang;
    document.documentElement.lang = 'de';
    document.documentElement.dataset.uiAuditContent = 'long';
    return textNodes.length;
  });
}

export async function restoreLongContentMode(page: Page): Promise<void> {
  await page.evaluate(() => {
    type AuditWindow = Window & {
      __uiAuditLongText?: Array<[Text, string]>;
      __uiAuditOriginalLang?: string;
    };
    const auditWindow = window as AuditWindow;
    for (const [node, original] of auditWindow.__uiAuditLongText ?? []) node.data = original;
    document.documentElement.lang = auditWindow.__uiAuditOriginalLang ?? '';
    delete auditWindow.__uiAuditLongText;
    delete auditWindow.__uiAuditOriginalLang;
    delete document.documentElement.dataset.uiAuditContent;
  });
}

export async function collectReducedMotionBehavior(page: Page): Promise<{
  mediaQueryMatches: boolean;
  activeMotion: string[];
}> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(50);
  return page.evaluate(() => {
    const selectorFor = (element: Element | null) => {
      if (!element) return 'unknown';
      if (element.id) return `#${CSS.escape(element.id)}`;
      return element.tagName.toLowerCase();
    };
    const activeMotion = document
      .getAnimations()
      .filter((animation) => {
        const duration = animation.effect?.getComputedTiming().duration;
        return (
          animation.playState === 'running' &&
          (duration === Infinity || (typeof duration === 'number' && duration > 100))
        );
      })
      .map((animation) =>
        selectorFor(animation.effect instanceof KeyframeEffect ? animation.effect.target : null),
      );
    return {
      mediaQueryMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
      activeMotion: [...new Set(activeMotion)].sort(),
    };
  });
}

export function assertCertificationEvidence(
  evidence: CertificationEvidence,
  routeId: string,
): void {
  const failures: string[] = [];
  if (evidence.keyboard?.focusEscaped) failures.push('keyboard focus escaped the document');
  if ((evidence.keyboard?.missed.length ?? 0) > 0) {
    failures.push(`keyboard missed ${evidence.keyboard!.missed.join(', ')}`);
  }
  if (evidence.reducedMotion && !evidence.reducedMotion.mediaQueryMatches) {
    failures.push('reduced-motion media query did not activate');
  }
  if ((evidence.reducedMotion?.activeMotion.length ?? 0) > 0) {
    failures.push(
      `reduced motion left active motion on ${evidence.reducedMotion!.activeMotion.join(', ')}`,
    );
  }
  if (evidence.coarsePointer?.requested && !evidence.coarsePointer.matched) {
    failures.push('coarse-pointer context did not activate');
  }
  if (failures.length > 0) throw new Error(`${routeId}: ${failures.join('; ')}`);
}

export async function runRouteCertification(
  page: Page,
  route: { id: string; archetype: RouteArchetype },
  viewport: { width: number; height: number },
  pointer: 'fine' | 'coarse',
): Promise<CertificationEvidence> {
  const requireSingleVisibleTitle = requiresSingleVisibleTitle(route.archetype);
  const criticalOptions: RuntimeUiDiagnosticOptions = { requireSingleVisibleTitle };
  const evidence: CertificationEvidence = {};

  evidence.keyboard = await collectKeyboardTraversal(page);

  const zoomViewport = exactZoomViewport(viewport, 200);
  await page.setViewportSize(zoomViewport);
  await page.waitForTimeout(50);
  evidence.zoom200 = await collectRuntimeUiDiagnostics(page, criticalOptions);
  assertCriticalRuntimeDiagnostics(evidence.zoom200, `${route.id}:zoom-200`, criticalOptions);
  await page.setViewportSize(viewport);

  const mutatedTextNodes = await applyLongContentMode(page);
  const longContentDiagnostics = await collectRuntimeUiDiagnostics(page, criticalOptions);
  evidence.longContent = { mutatedTextNodes, diagnostics: longContentDiagnostics };
  assertCriticalRuntimeDiagnostics(
    longContentDiagnostics,
    `${route.id}:long-content`,
    criticalOptions,
  );
  await restoreLongContentMode(page);

  const coarsePointerMatched = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  evidence.coarsePointer = { requested: pointer === 'coarse', matched: coarsePointerMatched };
  if (pointer === 'coarse') {
    const coarseOptions: RuntimeUiDiagnosticOptions = {
      requireSingleVisibleTitle,
      minimumInteractiveTargetPx: 44,
      enforceInteractiveTargetSize: true,
    };
    evidence.coarsePointer.diagnostics = await collectRuntimeUiDiagnostics(page, coarseOptions);
    assertCriticalRuntimeDiagnostics(
      evidence.coarsePointer.diagnostics,
      `${route.id}:coarse-pointer`,
      coarseOptions,
    );
  }

  evidence.reducedMotion = await collectReducedMotionBehavior(page);
  assertCertificationEvidence(evidence, route.id);
  return evidence;
}
