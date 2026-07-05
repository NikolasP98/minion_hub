import { describe, it, expect } from 'vitest';
import { deriveRegionFromEndpoint, resolveS3Config } from './s3';

describe('deriveRegionFromEndpoint', () => {
  it('extracts region from a B2-style endpoint hostname', () => {
    expect(deriveRegionFromEndpoint('https://s3.us-west-004.backblazeb2.com')).toBe(
      'us-west-004',
    );
  });

  it('returns null for a hostname that does not start with s3', () => {
    expect(deriveRegionFromEndpoint('https://example.com')).toBe(null);
  });

  it('returns null for an invalid url', () => {
    expect(deriveRegionFromEndpoint('not-a-url')).toBe(null);
  });
});

describe('resolveS3Config', () => {
  it('prefers STORAGE_* vars over B2_* fallback', () => {
    const cfg = resolveS3Config({
      STORAGE_ENDPOINT: 'https://storage.example.com',
      STORAGE_REGION: 'eu-1',
      STORAGE_ACCESS_KEY_ID: 'sk',
      STORAGE_SECRET_ACCESS_KEY: 'ss',
      STORAGE_BUCKET: 'bucket-a',
      B2_ENDPOINT: 'https://b2.example.com',
      B2_KEY_ID: 'b2key',
      B2_APP_KEY: 'b2secret',
      B2_BUCKET_NAME: 'b2bucket',
    } as unknown as NodeJS.ProcessEnv);

    expect(cfg).toEqual({
      endpoint: 'https://storage.example.com',
      region: 'eu-1',
      accessKeyId: 'sk',
      secretAccessKey: 'ss',
      bucket: 'bucket-a',
    });
  });

  it('falls back to B2_* vars and derives region from the endpoint', () => {
    const cfg = resolveS3Config({
      B2_ENDPOINT: 'https://s3.us-west-004.backblazeb2.com',
      B2_KEY_ID: 'b2key',
      B2_APP_KEY: 'b2secret',
      B2_BUCKET_NAME: 'b2bucket',
    } as unknown as NodeJS.ProcessEnv);

    expect(cfg.endpoint).toBe('https://s3.us-west-004.backblazeb2.com');
    expect(cfg.region).toBe('us-west-004');
    expect(cfg.accessKeyId).toBe('b2key');
    expect(cfg.secretAccessKey).toBe('b2secret');
    expect(cfg.bucket).toBe('b2bucket');
  });

  it('uses hardcoded defaults when nothing is set', () => {
    const cfg = resolveS3Config({} as NodeJS.ProcessEnv);
    expect(cfg.endpoint).toBe('');
    expect(cfg.region).toBe('us-west-004');
    expect(cfg.accessKeyId).toBe('');
    expect(cfg.secretAccessKey).toBe('');
    expect(cfg.bucket).toBe('minionhub');
  });
});
