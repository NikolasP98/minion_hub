// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { track } from './track';

afterEach(() => {
  delete (window as Window & { posthog?: unknown }).posthog;
});

describe('track', () => {
  it('is a no-op when posthog has not loaded yet', () => {
    expect(() => track('customer_search_no_results')).not.toThrow();
  });

  it('calls window.posthog.capture with the event and props', () => {
    const capture = vi.fn();
    window.posthog = { capture };
    track('visit_service_removed', { count: 2 });
    expect(capture).toHaveBeenCalledWith('visit_service_removed', { count: 2 });
  });

  it('swallows a throwing capture', () => {
    window.posthog = {
      capture: () => {
        throw new Error('private-capture-sentinel');
      },
    };
    expect(() => track('app_chunk_reload')).not.toThrow();
  });
});
