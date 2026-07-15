import { describe, expect, it } from 'vitest';
import {
  CAPTURE_NAVIGATION_ATTEMPTS,
  captureReadinessSelector,
  countColorBuckets,
  isOutdatedOptimizeDepMessage,
  isPotentialViteOptimizeDepResponse,
} from '../../../tests/e2e/ui-audit/capture-readiness';

describe('UI-audit capture readiness', () => {
  it('waits for the mounted app viewport or the shared public route shell', () => {
    expect(captureReadinessSelector({ id: 'screen:/home', family: 'immersive-workspaces' })).toBe(
      '[data-part="app-viewport"]',
    );
    expect(captureReadinessSelector({ id: 'screen:/login', family: 'public-auth' })).toBe(
      'main.public-task-scroll section.task-panel h1',
    );
  });

  it('bounds retries to Vite optimized-dependency 504 responses', () => {
    expect(CAPTURE_NAVIGATION_ATTEMPTS).toBe(2);
    expect(
      isPotentialViteOptimizeDepResponse(
        504,
        'http://127.0.0.1:5187/node_modules/.vite/deps/chunk-ABC.js?v=1',
      ),
    ).toBe(true);
    expect(
      isPotentialViteOptimizeDepResponse(
        500,
        'http://127.0.0.1:5187/node_modules/.vite/deps/chunk-ABC.js?v=1',
      ),
    ).toBe(false);
    expect(isPotentialViteOptimizeDepResponse(504, 'https://example.com/api/data')).toBe(false);
    expect(isOutdatedOptimizeDepMessage('Outdated Optimize Dep')).toBe(true);
    expect(isOutdatedOptimizeDepMessage('Gateway timeout')).toBe(false);
  });

  it('distinguishes a solid #09090b canvas from visible screenshot content', () => {
    const solid = new Uint8ClampedArray([9, 9, 11, 255, 9, 9, 11, 255]);
    const varied = new Uint8ClampedArray([9, 9, 11, 255, 250, 250, 250, 255]);

    expect(countColorBuckets(solid)).toBe(1);
    expect(countColorBuckets(varied)).toBe(2);
  });
});
