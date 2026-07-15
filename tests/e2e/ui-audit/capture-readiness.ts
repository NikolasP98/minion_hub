import type { Page, Response } from '@playwright/test';
import type { ScreenDesignMeta } from '../../../src/lib/routes/route-design-manifest';

const APP_VIEWPORT_SELECTOR = '[data-part="app-viewport"]';
const ROUTE_VIEWPORT_SELECTOR = '[data-part="route-viewport"]';
const PUBLIC_ROUTE_SELECTOR = 'main.public-task-scroll section.task-panel h1';
const CAPTURE_READY_TIMEOUT_MS = 15_000;
const VITE_RETRY_DELAY_MS = 250;
export const CAPTURE_NAVIGATION_ATTEMPTS = 2;

type CaptureReadinessRoute = Pick<ScreenDesignMeta, 'family' | 'id'>;

export interface ScreenshotDiversity {
  width: number;
  height: number;
  sampledPixels: number;
  distinctColorBuckets: number;
}

export interface CaptureNavigationResult {
  response: Response | null;
  recoveredOutdatedOptimizeDepUrls: string[];
}

export function captureReadinessSelector(route: CaptureReadinessRoute): string {
  return route.family === 'public-auth' ? PUBLIC_ROUTE_SELECTOR : APP_VIEWPORT_SELECTOR;
}

export function isPotentialViteOptimizeDepResponse(status: number, url: string): boolean {
  if (status !== 504) return false;
  try {
    const pathname = new URL(url).pathname;
    return pathname.includes('/node_modules/.vite/deps/') || pathname.includes('/@id/__x00__');
  } catch {
    return false;
  }
}

export function isOutdatedOptimizeDepMessage(value: string): boolean {
  return /outdated\s+optimi[sz]e\s+dep/i.test(value);
}

async function responseHasOutdatedOptimizeDep(response: Response): Promise<boolean> {
  if (!isPotentialViteOptimizeDepResponse(response.status(), response.url())) return false;
  try {
    return isOutdatedOptimizeDepMessage(await response.text());
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Wait for Svelte's client-only root to mount. A visible body is insufficient:
 * with root SSR disabled it exists before any route UI and produces a solid
 * canvas-colour screenshot.
 *
 * The public shell is included as a fallback so an auth/onboarding redirect is
 * reported by the route runner instead of being misreported as a readiness
 * timeout.
 */
export async function waitForCaptureReadiness(
  page: Page,
  route: CaptureReadinessRoute,
): Promise<void> {
  const expectedSelector = captureReadinessSelector(route);
  await page
    .locator(`${expectedSelector}, ${PUBLIC_ROUTE_SELECTOR}`)
    .first()
    .waitFor({ state: 'visible', timeout: CAPTURE_READY_TIMEOUT_MS });

  await page.waitForFunction(
    ({ expected, appViewport, routeViewport, publicRoute }) => {
      const visible = (element: Element | null): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) !== 0 &&
          rect.width > 0 &&
          rect.height > 0
        );
      };

      const publicTitle = document.querySelector(publicRoute);
      if (visible(publicTitle) && (publicTitle.textContent?.trim().length ?? 0) > 0) return true;

      const expectedRoot = document.querySelector(expected);
      if (!visible(expectedRoot)) return false;
      if (expected !== appViewport) return (expectedRoot.textContent?.trim().length ?? 0) > 0;

      const routedContent = document.querySelector(routeViewport);
      return visible(routedContent) && routedContent.childElementCount > 0;
    },
    {
      expected: expectedSelector,
      appViewport: APP_VIEWPORT_SELECTOR,
      routeViewport: ROUTE_VIEWPORT_SELECTOR,
      publicRoute: PUBLIC_ROUTE_SELECTOR,
    },
    { timeout: CAPTURE_READY_TIMEOUT_MS },
  );
}

/** Navigate once normally, retrying only the local Vite stale-dependency failure. */
export async function navigateToCaptureRoute(
  page: Page,
  url: string,
  route: CaptureReadinessRoute,
): Promise<CaptureNavigationResult> {
  let lastError: unknown;
  const recoveredOutdatedOptimizeDepUrls = new Set<string>();

  for (let attempt = 1; attempt <= CAPTURE_NAVIGATION_ATTEMPTS; attempt += 1) {
    const possibleOutdatedResponses: Array<{ url: string; result: Promise<boolean> }> = [];
    const onResponse = (response: Response) => {
      if (isPotentialViteOptimizeDepResponse(response.status(), response.url())) {
        possibleOutdatedResponses.push({
          url: response.url(),
          result: responseHasOutdatedOptimizeDep(response),
        });
      }
    };
    page.on('response', onResponse);

    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
      await waitForCaptureReadiness(page, route);
      return { response, recoveredOutdatedOptimizeDepUrls: [...recoveredOutdatedOptimizeDepUrls] };
    } catch (error) {
      lastError = error;
      const responseSignals = await Promise.all(
        possibleOutdatedResponses.map(async ({ url: responseUrl, result }) => ({
          url: responseUrl,
          outdated: await result.catch(() => false),
        })),
      );
      const responseWasOutdated = responseSignals.some((signal) => signal.outdated);
      const bodyWasOutdated = isOutdatedOptimizeDepMessage(
        await page
          .locator('body')
          .innerText()
          .catch(() => ''),
      );
      const retryable = responseWasOutdated || bodyWasOutdated;
      if (!retryable || attempt === CAPTURE_NAVIGATION_ATTEMPTS) break;
      for (const signal of responseSignals) {
        if (signal.outdated) recoveredOutdatedOptimizeDepUrls.add(signal.url);
      }
      await page.waitForTimeout(VITE_RETRY_DELAY_MS);
    } finally {
      page.off('response', onResponse);
    }
  }

  throw new Error(
    `${route.id}: route UI did not become capture-ready after ${CAPTURE_NAVIGATION_ATTEMPTS} attempts: ${errorMessage(lastError)}`,
  );
}

/**
 * Assert meaningful mounted content before encoding the screenshot. This is
 * intentionally independent from route-title certification because canvas and
 * workspace archetypes do not all expose a visible h1.
 */
export async function assertCaptureContentReady(
  page: Page,
  route: CaptureReadinessRoute,
): Promise<void> {
  const expectedSelector = captureReadinessSelector(route);
  const evidence = await page.evaluate(
    ({ expected, appViewport, routeViewport }) => {
      const visible = (element: Element): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) !== 0 &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      const root = document.querySelector(expected);
      const routedContent = document.querySelector(routeViewport);
      const meaningful = [
        ...document.querySelectorAll(
          'h1, h2, p, button, a[href], input:not([type="hidden"]), textarea, select, img, svg, canvas, [role]',
        ),
      ].filter(visible);
      const bodyTextLength = document.body.innerText.trim().length;
      const rootRect = root instanceof HTMLElement ? root.getBoundingClientRect() : null;
      return {
        expectedVisible: root instanceof HTMLElement && visible(root),
        routedContentPresent:
          expected !== appViewport ||
          (routedContent instanceof HTMLElement &&
            visible(routedContent) &&
            routedContent.childElementCount > 0),
        bodyTextLength,
        meaningfulElements: meaningful.length,
        rootArea: rootRect ? rootRect.width * rootRect.height : 0,
      };
    },
    {
      expected: expectedSelector,
      appViewport: APP_VIEWPORT_SELECTOR,
      routeViewport: ROUTE_VIEWPORT_SELECTOR,
    },
  );

  if (
    !evidence.expectedVisible ||
    !evidence.routedContentPresent ||
    evidence.bodyTextLength === 0 ||
    evidence.meaningfulElements === 0 ||
    evidence.rootArea === 0
  ) {
    throw new Error(
      `${route.id}: mounted page has no certifiable capture content (${JSON.stringify(evidence)})`,
    );
  }
}

export function countColorBuckets(rgba: ArrayLike<number>): number {
  const buckets = new Set<number>();
  for (let pixel = 0; pixel + 3 < rgba.length; pixel += 4) {
    const red = rgba[pixel] ?? 0;
    const green = rgba[pixel + 1] ?? 0;
    const blue = rgba[pixel + 2] ?? 0;
    buckets.add(((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4));
  }
  return buckets.size;
}

/** Decode a bounded screenshot sample in the existing Chromium page context. */
export async function screenshotDiversity(page: Page, png: Buffer): Promise<ScreenshotDiversity> {
  return page.evaluate(async (base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const originalWidth = image.width;
    const originalHeight = image.height;
    const width = Math.min(image.width, 128);
    const height = Math.min(image.height, 128);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Capture screenshot canvas context is unavailable.');
    context.drawImage(image, 0, 0, width, height);
    image.close();
    const rgba = context.getImageData(0, 0, width, height).data;
    const buckets = new Set<number>();
    for (let pixel = 0; pixel + 3 < rgba.length; pixel += 4) {
      const red = rgba[pixel] ?? 0;
      const green = rgba[pixel + 1] ?? 0;
      const blue = rgba[pixel + 2] ?? 0;
      buckets.add(((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4));
    }
    return {
      width: originalWidth,
      height: originalHeight,
      sampledPixels: width * height,
      distinctColorBuckets: buckets.size,
    };
  }, png.toString('base64'));
}

export async function assertScreenshotHasVisualDiversity(
  page: Page,
  png: Buffer,
  routeId: string,
): Promise<void> {
  const diversity = await screenshotDiversity(page, png);
  if (diversity.distinctColorBuckets < 2) {
    throw new Error(
      `${routeId}: screenshot is visually blank (${diversity.width}x${diversity.height}, ${diversity.distinctColorBuckets} sampled colour bucket)`,
    );
  }
}
