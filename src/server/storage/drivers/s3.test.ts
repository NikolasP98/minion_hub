import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deriveRegionFromEndpoint, resolveS3Config } from './s3';

const mockSend = vi.fn();
// vi.fn() implementations must be `function`, not arrow — every export here is
// invoked with `new` by the driver, and arrow functions have no [[Construct]].
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function S3Client() {
    return { send: mockSend };
  }),
  PutObjectCommand: vi.fn(function PutObjectCommand(input: unknown) {
    return { input };
  }),
  DeleteObjectCommand: vi.fn(function DeleteObjectCommand(input: unknown) {
    return { input };
  }),
  GetObjectCommand: vi.fn(function GetObjectCommand(input: unknown) {
    return { input };
  }),
  HeadObjectCommand: vi.fn(function HeadObjectCommand(input: unknown) {
    return { input };
  }),
}));

const mockPresign = vi.fn<(...args: unknown[]) => Promise<string>>();
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => mockPresign(...args),
}));

describe('deriveRegionFromEndpoint', () => {
  it('extracts region from a B2-style endpoint hostname', () => {
    expect(deriveRegionFromEndpoint('https://s3.us-west-004.backblazeb2.com')).toBe('us-west-004');
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

describe('s3Driver.presignPut / head', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPresign.mockResolvedValue('https://signed.example.com/put');
  });

  it('presignPut returns the presigned url for a PutObjectCommand', async () => {
    const { s3Driver } = await import('./s3');
    const url = await s3Driver.presignPut('org-1/attachments/f1/doc.pdf', 'application/pdf', 900, {
      contentLength: 1234,
    });
    expect(url).toBe('https://signed.example.com/put');
    expect(mockPresign).toHaveBeenCalled();
  });

  it('head returns size + contentType when the object exists', async () => {
    mockSend.mockResolvedValueOnce({ ContentLength: 4321, ContentType: 'application/pdf' });
    const { s3Driver } = await import('./s3');
    expect(await s3Driver.head('org-1/attachments/f1/doc.pdf')).toEqual({
      size: 4321,
      contentType: 'application/pdf',
    });
  });

  it('head returns null on a 404 (no retry)', async () => {
    mockSend.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } });
    const { s3Driver } = await import('./s3');
    expect(await s3Driver.head('missing/key')).toBe(null);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('head re-throws a non-404 error after one retry', async () => {
    mockSend.mockRejectedValue({ $metadata: { httpStatusCode: 500 } });
    const { s3Driver } = await import('./s3');
    await expect(s3Driver.head('key')).rejects.toBeTruthy();
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});
