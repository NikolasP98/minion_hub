export type ApiErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'validation'
  | 'conflict'
  | 'unavailable'
  | 'network'
  | 'cancelled'
  | 'unexpected';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: ApiErrorKind,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 400 || status === 422) return 'validation';
  if (status === 409) return 'conflict';
  if (status === 502 || status === 503 || status === 504) return 'unavailable';
  return 'unexpected';
}

function safeMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const record = body as Record<string, unknown>;
  const candidate = typeof record.message === 'string' ? record.message : record.error;
  if (typeof candidate !== 'string') return fallback;
  const trimmed = candidate.trim();
  return trimmed && trimmed.length <= 300 ? trimmed : fallback;
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return undefined;
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) return undefined;
  return response.json().catch(() => undefined);
}

/** A fetch that cannot accidentally treat an HTTP error as success. */
export async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw new ApiError('Request cancelled', 'cancelled', 0, cause);
    }
    throw new ApiError('Network request failed', 'network', 0, cause);
  }

  const body = await parseBody(response);
  if (!response.ok) {
    const fallback = `Request failed (${response.status})`;
    throw new ApiError(
      safeMessage(body, fallback),
      kindForStatus(response.status),
      response.status,
      body,
    );
  }
  return body as T;
}
