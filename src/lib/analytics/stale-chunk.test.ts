import { describe, expect, it } from 'vitest';
import { isStaleChunkError, shouldReloadForStaleChunk, type ReloadGuardStorage } from './stale-chunk';

function memoryStorage(): ReloadGuardStorage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  };
}

describe('isStaleChunkError', () => {
  it('matches the known stale-chunk error shapes', () => {
    expect(isStaleChunkError('error loading dynamically imported module: /chunk.js')).toBe(true);
    expect(isStaleChunkError('Failed to fetch dynamically imported module')).toBe(true);
    expect(isStaleChunkError('Importing a module script failed')).toBe(true);
    expect(isStaleChunkError('Loading chunk 42 failed')).toBe(true);
    expect(isStaleChunkError('Loading CSS chunk 3 failed')).toBe(true);
  });

  it('does not match an unrelated error or non-string input', () => {
    expect(isStaleChunkError('TypeError: cannot read properties of undefined')).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
  });
});

describe('shouldReloadForStaleChunk', () => {
  it('reloads on first occurrence and sets the guard', () => {
    const storage = memoryStorage();
    expect(shouldReloadForStaleChunk(1_000, storage)).toBe(true);
    expect(storage.getItem('hub:chunk-reload')).toBe('1000');
  });

  it('refuses a second reload within the 60s window', () => {
    const storage = memoryStorage();
    expect(shouldReloadForStaleChunk(1_000, storage)).toBe(true);
    expect(shouldReloadForStaleChunk(1_000 + 59_999, storage)).toBe(false);
  });

  it('allows a reload again once the window has passed', () => {
    const storage = memoryStorage();
    expect(shouldReloadForStaleChunk(1_000, storage)).toBe(true);
    expect(shouldReloadForStaleChunk(1_000 + 60_000, storage)).toBe(true);
  });

  it('defaults to reloading when storage access throws', () => {
    const hostile: ReloadGuardStorage = {
      getItem: () => {
        throw new Error('private-storage-sentinel');
      },
      setItem: () => {
        throw new Error('private-storage-sentinel');
      },
    };
    expect(shouldReloadForStaleChunk(1_000, hostile)).toBe(true);
  });
});
