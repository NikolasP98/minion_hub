import { describe, it, expect, beforeEach, vi } from 'vitest';

const ORIGINAL_PROVIDER = process.env.STORAGE_PROVIDER;

beforeEach(() => {
  vi.resetModules();
  if (ORIGINAL_PROVIDER === undefined) delete process.env.STORAGE_PROVIDER;
  else process.env.STORAGE_PROVIDER = ORIGINAL_PROVIDER;
});

describe('getStorage', () => {
  it('defaults to the s3 driver when STORAGE_PROVIDER is unset', async () => {
    delete process.env.STORAGE_PROVIDER;
    const { getStorage } = await import('./blob');
    const driver = getStorage();
    expect(typeof driver.put).toBe('function');
    expect(typeof driver.getSignedUrl).toBe('function');
    expect(typeof driver.delete).toBe('function');
  });

  it('throws on an unknown provider', async () => {
    process.env.STORAGE_PROVIDER = 'azure';
    const { getStorage } = await import('./blob');
    expect(() => getStorage()).toThrow(/Unknown STORAGE_PROVIDER: azure/);
  });
});

describe('isStorageConfigured', () => {
  it('false when endpoint/creds are missing', async () => {
    const { isStorageConfigured } = await import('./blob');
    const saved = {
      STORAGE_ENDPOINT: process.env.STORAGE_ENDPOINT,
      STORAGE_ACCESS_KEY_ID: process.env.STORAGE_ACCESS_KEY_ID,
      STORAGE_SECRET_ACCESS_KEY: process.env.STORAGE_SECRET_ACCESS_KEY,
      B2_ENDPOINT: process.env.B2_ENDPOINT,
      B2_KEY_ID: process.env.B2_KEY_ID,
      B2_APP_KEY: process.env.B2_APP_KEY,
    };
    for (const k of Object.keys(saved)) delete process.env[k];
    try {
      expect(isStorageConfigured()).toBe(false);
    } finally {
      for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
    }
  });

  it('true when B2_* fallback vars are present (set by test-utils/setup.ts)', async () => {
    const { isStorageConfigured } = await import('./blob');
    expect(isStorageConfigured()).toBe(true);
  });
});
