import { describe, it, expect } from 'vitest';
import { resolveOpenMode } from './peek.svelte';

describe('resolveOpenMode', () => {
  it('explicit always wins', () => {
    expect(resolveOpenMode('modal', 'tray', 'page')).toBe('modal');
  });
  it('falls back to the user preference over the org config', () => {
    expect(resolveOpenMode(null, 'tray', 'modal')).toBe('tray');
    expect(resolveOpenMode(undefined, 'tray', 'modal')).toBe('tray');
  });
  it('falls back to the org config when there is no user preference', () => {
    expect(resolveOpenMode(null, null, 'modal')).toBe('modal');
  });
  it('defaults to "page" when nothing resolves', () => {
    expect(resolveOpenMode(null, null, null)).toBe('page');
    expect(resolveOpenMode()).toBe('page');
  });
});
