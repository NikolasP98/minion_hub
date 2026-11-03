import { describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/public', () => ({ env }));

const { browserSharedTokenOff } = await import('./gateway-browser-token');

describe('browserSharedTokenOff', () => {
  it.each([
    ['false', true],
    ['FALSE', true],
    [' false\n', true],
    ['true', false],
    ['', false],
    [undefined, false],
  ])('%j → %s', (value, expected) => {
    env.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN = value;
    expect(browserSharedTokenOff()).toBe(expected);
  });
});
