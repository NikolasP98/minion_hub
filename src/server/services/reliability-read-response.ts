import { error as httpError } from '@sveltejs/kit';

export const RELIABILITY_RESPONSE_MAX_BYTES = 8 * 1024 * 1024;

export class ReliabilityReadResponseError extends Error {
  readonly status = 503;
  readonly code = 'reliability_response_too_large';
  constructor() {
    super('Reliability data is temporarily unavailable');
    this.name = 'ReliabilityReadResponseError';
  }
}

/** Serialize once so the byte assertion and the transmitted bytes are identical. */
export function boundedReliabilityJson(value: unknown): Response {
  const body = JSON.stringify(value);
  if (new TextEncoder().encode(body).byteLength > RELIABILITY_RESPONSE_MAX_BYTES) {
    throw new ReliabilityReadResponseError();
  }
  return new Response(body, {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'private, no-store',
    },
  });
}

export function throwReliabilityReadHttpError(caught: unknown): never {
  if (
    caught &&
    typeof caught === 'object' &&
    'status' in caught &&
    typeof caught.status === 'number' &&
    'code' in caught &&
    typeof caught.code === 'string'
  ) {
    throw httpError(caught.status, caught.code);
  }
  throw caught;
}
