import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl as presignGetUrl } from '@aws-sdk/s3-request-presigner';
import type { BlobStorageDriver } from '../blob';

/** Per-request timeout — a hung storage call aborts instead of hanging the caller forever. */
const REQUEST_TIMEOUT_MS = 30_000;

export interface S3Config {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/**
 * Derive a region slug from an S3-compatible endpoint hostname, e.g.
 * `s3.us-west-004.backblazeb2.com` → `us-west-004`. Returns null when the
 * hostname doesn't look like `s3.<region>.<host>`.
 */
export function deriveRegionFromEndpoint(endpoint: string): string | null {
  try {
    const { hostname } = new URL(endpoint);
    const parts = hostname.split('.');
    if (parts.length >= 3 && parts[0] === 's3') return parts[1];
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve S3-compatible config from env: generic `STORAGE_*` names first,
 * falling back to the pre-existing `B2_*` vars (zero prod env churn — see
 * specs/2026-07-05-meta-post-thumbnail-mirroring.md §8).
 */
export function resolveS3Config(env: NodeJS.ProcessEnv = process.env): S3Config {
  const endpoint = env.STORAGE_ENDPOINT ?? env.B2_ENDPOINT ?? '';
  const region =
    env.STORAGE_REGION ?? env.B2_REGION ?? deriveRegionFromEndpoint(endpoint) ?? 'us-west-004';
  return {
    endpoint,
    region,
    accessKeyId: env.STORAGE_ACCESS_KEY_ID ?? env.B2_KEY_ID ?? '',
    secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY ?? env.B2_APP_KEY ?? '',
    bucket: env.STORAGE_BUCKET ?? env.B2_BUCKET_NAME ?? 'minionhub',
  };
}

let _client: S3Client | null = null;
let _bucket: string | null = null;

function getClient(): { client: S3Client; bucket: string } {
  if (!_client) {
    const cfg = resolveS3Config();
    _client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
    _bucket = cfg.bucket;
  }
  return { client: _client, bucket: _bucket! };
}

/** 5xx and network/timeout errors are retryable; anything with a 4xx status is not. */
function isRetryable(err: unknown): boolean {
  const status = (err as { $metadata?: { httpStatusCode?: number } } | undefined)?.$metadata
    ?.httpStatusCode;
  if (typeof status === 'number') return status >= 500;
  return true;
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fn(ctrl.signal);
  } finally {
    clearTimeout(t);
  }
}

// ponytail: simple try/once-retry, no backoff/retry framework — matches susii-client's
// posture but even leaner since storage calls are idempotent single-shot puts/deletes.
async function sendWithRetry<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  try {
    return await withTimeout(fn);
  } catch (err) {
    if (!isRetryable(err)) throw err;
    return await withTimeout(fn);
  }
}

export const s3Driver: BlobStorageDriver = {
  async put(key, body, contentType, opts) {
    const { client, bucket } = getClient();
    await sendWithRetry((signal) =>
      client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: opts?.cacheControl,
        }),
        { abortSignal: signal },
      ),
    );
  },

  async getSignedUrl(key, expiresIn = 3600) {
    const { client, bucket } = getClient();
    return presignGetUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn,
    });
  },

  async delete(key) {
    const { client, bucket } = getClient();
    await sendWithRetry((signal) =>
      client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: signal }),
    );
  },
};
