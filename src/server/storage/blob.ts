import { s3Driver, resolveS3Config } from './drivers/s3';

/**
 * Provider-agnostic blob storage. One driver (S3-compatible) covers
 * AWS/B2/R2/MinIO/Spaces — they all speak the S3 API, so provider-agnosticism
 * within that family is a config concern, not a code concern.
 *
 * // ponytail: s3 driver only — add drivers/azure.ts behind this same
 * // interface when an Azure tenant exists.
 *
 * See specs/2026-07-05-meta-post-thumbnail-mirroring.md §8.
 */
export interface BlobStorageDriver {
  put(
    key: string,
    body: Buffer | Uint8Array,
    contentType: string,
    opts?: { cacheControl?: string },
  ): Promise<void>;
  getSignedUrl(key: string, expiresIn?: number): Promise<string>;
  delete(key: string): Promise<void>;
  /** Browser-direct upload URL (attachments intent flow) — the caller PUTs the
   *  file straight to storage, bypassing Vercel's serverless body cap. */
  presignPut(
    key: string,
    contentType: string,
    expiresIn?: number,
    opts?: { contentLength?: number },
  ): Promise<string>;
  /** Verify an object landed after a presigned PUT. Null when it doesn't exist. */
  head(key: string): Promise<{ size: number; contentType: string | null } | null>;
}

let _driver: BlobStorageDriver | null = null;

/** Lazy singleton, driver picked by `STORAGE_PROVIDER` (default + only valid value v1: `'s3'`). */
export function getStorage(): BlobStorageDriver {
  if (_driver) return _driver;
  const provider = process.env.STORAGE_PROVIDER ?? 's3';
  if (provider !== 's3') throw new Error(`Unknown STORAGE_PROVIDER: ${provider}`);
  _driver = s3Driver;
  return _driver;
}

/** Single source of truth for "is blob storage usable" (endpoint + creds present). */
export function isStorageConfigured(): boolean {
  const cfg = resolveS3Config();
  return !!(cfg.endpoint && cfg.accessKeyId && cfg.secretAccessKey);
}
