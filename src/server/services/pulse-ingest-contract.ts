import type { ProposalInput } from './pulse.service';

export const PULSE_REQUEST_MAX_BYTES = 256 * 1024;
export const PULSE_MAX_CARDS = 100;
export const PULSE_PAYLOAD_MAX_BYTES = 16 * 1024;

export type PulseIngestErrorCode =
  'body_too_large' | 'invalid_json' | 'invalid_body' | 'invalid_legacy_org' | 'invalid_proposals';

export class PulseIngestError extends Error {
  constructor(
    readonly code: PulseIngestErrorCode,
    readonly status: 400 | 413 = 400,
  ) {
    super(code);
    this.name = 'PulseIngestError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function scalarLength(value: string): number | null {
  let length = 0;
  for (const scalar of value) {
    const point = scalar.codePointAt(0);
    if (point === undefined || (point >= 0xd800 && point <= 0xdfff)) return null;
    length += 1;
  }
  return length;
}

function boundedString(value: unknown, min: number, max: number): value is string {
  if (typeof value !== 'string') return false;
  const length = scalarLength(value);
  return length !== null && length >= min && length <= max;
}

/** Stable JSON bytes keep the Hub and Gateway payload admission limits identical. */
export function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 32) throw new PulseIngestError('invalid_proposals');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new PulseIngestError('invalid_proposals');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item, depth + 1)).join(',')}]`;
  }
  if (!isRecord(value)) throw new PulseIngestError('invalid_proposals');
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], depth + 1)}`)
    .join(',')}}`;
}

export async function readPulseRequestObject(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new PulseIngestError('invalid_json');

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > PULSE_REQUEST_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new PulseIngestError('body_too_large', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let parsed: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new PulseIngestError('invalid_json');
  }
  if (!isRecord(parsed)) throw new PulseIngestError('invalid_body');
  return parsed;
}

export function legacyOrgId(body: Record<string, unknown>): string | undefined {
  if (!Object.hasOwn(body, 'orgId')) return undefined;
  if (!boundedString(body.orgId, 1, 100)) throw new PulseIngestError('invalid_legacy_org');
  return body.orgId;
}

export function validatePulseProposals(body: Record<string, unknown>): ProposalInput[] {
  if (
    !Array.isArray(body.proposals) ||
    body.proposals.length < 1 ||
    body.proposals.length > PULSE_MAX_CARDS
  ) {
    throw new PulseIngestError('invalid_proposals');
  }

  return body.proposals.map((value) => {
    if (!isRecord(value)) throw new PulseIngestError('invalid_proposals');
    if (
      !boundedString(value.source, 1, 100) ||
      !boundedString(value.kind, 1, 100) ||
      !boundedString(value.title, 1, 500) ||
      !boundedString(value.dedupKey, 1, 250) ||
      (value.summary !== undefined && !boundedString(value.summary, 0, 4000)) ||
      (value.payload !== undefined && !isRecord(value.payload))
    ) {
      throw new PulseIngestError('invalid_proposals');
    }

    const payload = value.payload as Record<string, unknown> | undefined;
    if (payload !== undefined) {
      const canonical = canonicalJson(payload);
      if (new TextEncoder().encode(canonical).byteLength > PULSE_PAYLOAD_MAX_BYTES) {
        throw new PulseIngestError('invalid_proposals');
      }
    }

    return {
      source: value.source,
      kind: value.kind,
      title: value.title,
      ...(value.summary === undefined ? {} : { summary: value.summary }),
      ...(payload === undefined ? {} : { payload }),
      dedupKey: value.dedupKey,
    };
  });
}
