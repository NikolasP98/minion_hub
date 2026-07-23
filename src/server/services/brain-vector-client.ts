import { createHash, createHmac, createPrivateKey, randomUUID } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { SignJWT, importJWK, importPKCS8, type JWK } from 'jose';
import { EMBEDDING_DIMENSIONS } from './embeddings';

export const BRAIN_VECTOR_CONTRACT_VERSION = 1 as const;
export const BRAIN_VECTOR_GENERATION_DEFAULT = 'openai_te3s_1536_g1';
export const BRAIN_VECTOR_MAX_SOURCE_IDS = 512;
export const BRAIN_VECTOR_MAX_CANDIDATES = 200;
export const BRAIN_VECTOR_MAX_KINDS = 32;
export const BRAIN_VECTOR_MAX_KIND_LENGTH = 64;
export const BRAIN_VECTOR_SOURCE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
export const BRAIN_VECTOR_GENERATION_PATTERN = /^[a-z0-9_]{1,64}$/u;
export const BRAIN_VECTOR_COLLECTION_PREFIX = 'minion_brains_v1' as const;
export const BRAIN_VECTOR_CAPABILITY_ALG = 'EdDSA' as const;
export const BRAIN_VECTOR_CAPABILITY_CURVE = 'Ed25519' as const;
const CAPABILITY_TTL_SECONDS = 60;
const REQUEST_TIMEOUT_MS = 800;

interface BrainVectorSearchFilterBaseV1 {
  kinds?: string[];
  occurredAfter?: string | null;
  occurredBefore?: string | null;
}

export type BrainVectorSearchFilters = BrainVectorSearchFilterBaseV1 &
  ({ scopeMode: 'source_list'; sourceIds: string[] } | { scopeMode: 'org_all'; sourceIds?: never });

export interface BrainVectorCandidate {
  chunkId: string;
  score: number;
  indexedFingerprint: string;
}

export interface BrainVectorSearchResponse {
  contractVersion: typeof BRAIN_VECTOR_CONTRACT_VERSION;
  generation: string;
  collection: string;
  tookMs: number;
  candidates: BrainVectorCandidate[];
}

export interface BrainVectorClientConfig {
  url: string;
  signingPrivateKey: string;
  signingKid: string;
  fingerprintKey: string;
  generation: string;
  issuer: string;
  audience: string;
  timeoutMs: number;
}

export interface BrainVectorSearchInput {
  orgId: string;
  brainId: string;
  subject: string;
  vector: number[];
  limit: number;
  filters: BrainVectorSearchFilters;
}

export function brainVectorCollectionName(generation: string): string {
  if (!BRAIN_VECTOR_GENERATION_PATTERN.test(generation)) {
    throw new Error('generation must be 1-64 lowercase ASCII letters, digits, or underscores');
  }
  return `${BRAIN_VECTOR_COLLECTION_PREFIX}__${generation}`;
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

export function canonicalizeBrainVectorSourceIds(sourceIds: readonly string[]): string[] {
  if (sourceIds.some((sourceId) => !BRAIN_VECTOR_SOURCE_ID_PATTERN.test(sourceId))) {
    throw new Error(
      'source IDs must use only ASCII letters, digits, dot, underscore, colon, or hyphen (1-128 chars)',
    );
  }
  return [...new Set(sourceIds)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/** Versioned shared-contract fixture. Never replace this with delimiter joining. */
export function brainVectorSourceScopeHash(sourceIds: readonly string[]): string {
  const canonical = JSON.stringify([
    'minion-source-scope-v1',
    ...canonicalizeBrainVectorSourceIds(sourceIds),
  ]);
  return `sha256:v1:${base64url(createHash('sha256').update(canonical, 'utf8').digest())}`;
}

/** Versioned keyed stale-point fingerprint. No chunk text enters Qdrant. */
export function brainVectorContentFingerprint(
  key: string,
  chunkId: string,
  contentHash: string,
  generation: string,
): string {
  const keyBytes = Buffer.from(key, 'utf8');
  if (keyBytes.byteLength < 32) {
    throw new Error('BRAIN_VECTOR_FINGERPRINT_KEY must contain at least 32 UTF-8 bytes');
  }
  for (const [field, value] of [
    ['chunkId', chunkId],
    ['contentHash', contentHash],
    ['generation', generation],
  ] as const) {
    if (value.length === 0) throw new Error(`${field} must be non-empty`);
  }
  const canonical = JSON.stringify([
    'minion-content-fingerprint-v1',
    chunkId,
    contentHash,
    generation,
  ]);
  return `hmac-sha256:v1:${base64url(createHmac('sha256', keyBytes).update(canonical, 'utf8').digest())}`;
}

export function brainVectorServingEnabled(): boolean {
  return env.BRAIN_VECTOR_ENABLED === 'true';
}

function positiveInt(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), max) : fallback;
}

function isUtcInstant(value: string | null | undefined): boolean {
  if (value === undefined || value === null) return true;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/u.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth[month - 1]! &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59
  );
}

export function brainVectorClientConfig(): BrainVectorClientConfig {
  const config = {
    url: env.BRAIN_VECTOR_URL?.trim() || env.BRAIN_VECTOR_API_URL?.trim() || '',
    signingPrivateKey: env.BRAIN_VECTOR_SIGNING_PRIVATE_KEY?.trim() ?? '',
    signingKid: env.BRAIN_VECTOR_SIGNING_KID?.trim() ?? '',
    // The shared v1 contract treats this as raw UTF-8 key material. Do not
    // normalize it: the worker and Hub must HMAC the exact same bytes.
    fingerprintKey: env.BRAIN_VECTOR_FINGERPRINT_KEY ?? '',
    generation: env.BRAIN_VECTOR_GENERATION?.trim() || BRAIN_VECTOR_GENERATION_DEFAULT,
    issuer: env.BRAIN_VECTOR_JWT_ISSUER?.trim() || 'minion-hub',
    audience: env.BRAIN_VECTOR_JWT_AUDIENCE?.trim() || 'minion-brain-vector',
    timeoutMs: positiveInt(env.BRAIN_VECTOR_TIMEOUT_MS, REQUEST_TIMEOUT_MS, 5_000),
  };
  if (!config.url || !config.signingPrivateKey || !config.signingKid || !config.fingerprintKey) {
    throw new Error(
      'Brain vector serving is enabled but its URL/signing/fingerprint config is incomplete',
    );
  }
  if (Buffer.byteLength(config.fingerprintKey, 'utf8') < 32) {
    throw new Error('BRAIN_VECTOR_FINGERPRINT_KEY must contain at least 32 UTF-8 bytes');
  }
  if (config.issuer !== 'minion-hub' || config.audience !== 'minion-brain-vector') {
    throw new Error('Brain vector v1 issuer and audience are fixed by the shared contract');
  }
  brainVectorCollectionName(config.generation);
  const url = new URL(config.url);
  const local =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('BRAIN_VECTOR_URL must use HTTPS outside localhost');
  }
  return config;
}

type SigningKey = Awaited<ReturnType<typeof importPKCS8>> | Awaited<ReturnType<typeof importJWK>>;
let cachedPrivateKey: { encoded: string; key: SigningKey } | null = null;

function decodeConfiguredKey(encoded: string): string {
  if (encoded.startsWith('{') || encoded.startsWith('-----BEGIN')) return encoded;
  return Buffer.from(encoded, 'base64').toString('utf8').trim();
}

async function importSigningKey(encoded: string): Promise<SigningKey> {
  if (cachedPrivateKey?.encoded === encoded) return cachedPrivateKey.key;
  const decoded = decodeConfiguredKey(encoded);
  let key: SigningKey;
  if (decoded.startsWith('{')) {
    const jwk = JSON.parse(decoded) as JWK;
    if (jwk.kty !== 'OKP' || jwk.crv !== BRAIN_VECTOR_CAPABILITY_CURVE) {
      throw new Error('Brain vector signing JWK must be an Ed25519 private key');
    }
    key = await importJWK(jwk, BRAIN_VECTOR_CAPABILITY_ALG);
  } else {
    if (createPrivateKey(decoded).asymmetricKeyType !== 'ed25519') {
      throw new Error('Brain vector signing PEM must be an Ed25519 private key');
    }
    key = await importPKCS8(decoded, BRAIN_VECTOR_CAPABILITY_ALG);
  }
  cachedPrivateKey = { encoded, key };
  return key;
}

export async function mintBrainVectorCapability(
  config: BrainVectorClientConfig,
  input: Pick<BrainVectorSearchInput, 'orgId' | 'brainId' | 'subject'> & { sourceIds: string[] },
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const sourceIds = canonicalizeBrainVectorSourceIds(input.sourceIds);
  if (sourceIds.length === 0 || sourceIds.length > BRAIN_VECTOR_MAX_SOURCE_IDS) {
    throw new Error(`Brain vector capability requires 1-${BRAIN_VECTOR_MAX_SOURCE_IDS} sources`);
  }
  if (
    !input.orgId ||
    !input.brainId ||
    !input.subject ||
    !BRAIN_VECTOR_GENERATION_PATTERN.test(config.generation)
  ) {
    throw new Error('Brain vector capability identity or generation is invalid');
  }
  const privateKey = await importSigningKey(config.signingPrivateKey);
  return new SignJWT({
    org_id: input.orgId,
    brain_id: input.brainId,
    generation: config.generation,
    source_scope_mode: 'source_list',
    source_scope_hash: brainVectorSourceScopeHash(sourceIds),
    op: 'search',
  })
    .setProtectedHeader({ alg: BRAIN_VECTOR_CAPABILITY_ALG, typ: 'JWT', kid: config.signingKid })
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setSubject(input.subject)
    .setJti(randomUUID())
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + CAPABILITY_TTL_SECONDS)
    .sign(privateKey);
}

function parseResponse(
  value: unknown,
  generation: string,
  requestLimit: number,
): BrainVectorSearchResponse {
  if (!value || typeof value !== 'object')
    throw new Error('Vector API returned a malformed response');
  const row = value as Record<string, unknown>;
  if (
    row.contractVersion !== BRAIN_VECTOR_CONTRACT_VERSION ||
    row.generation !== generation ||
    row.collection !== brainVectorCollectionName(generation)
  ) {
    throw new Error('Vector API returned a mismatched generation or collection');
  }
  if (
    !Number.isFinite(row.tookMs) ||
    (row.tookMs as number) < 0 ||
    !Array.isArray(row.candidates)
  ) {
    throw new Error('Vector API returned malformed diagnostics or candidates');
  }
  if (row.candidates.length > requestLimit || row.candidates.length > BRAIN_VECTOR_MAX_CANDIDATES) {
    throw new Error('Vector API returned too many candidates');
  }
  const candidates = row.candidates.map((candidate) => {
    if (!candidate || typeof candidate !== 'object') throw new Error('Malformed vector candidate');
    const item = candidate as Record<string, unknown>;
    if (
      typeof item.chunkId !== 'string' ||
      item.chunkId.length === 0 ||
      !Number.isFinite(item.score) ||
      typeof item.indexedFingerprint !== 'string' ||
      item.indexedFingerprint.length === 0
    ) {
      throw new Error('Vector API returned an invalid candidate');
    }
    return {
      chunkId: item.chunkId,
      score: item.score as number,
      indexedFingerprint: item.indexedFingerprint,
    };
  });
  return {
    contractVersion: BRAIN_VECTOR_CONTRACT_VERSION,
    generation,
    collection: row.collection,
    tookMs: row.tookMs as number,
    candidates,
  };
}

export async function searchBrainVectorApi(
  config: BrainVectorClientConfig,
  input: BrainVectorSearchInput,
  fetchImpl: typeof fetch = fetch,
): Promise<BrainVectorSearchResponse> {
  if (input.filters.scopeMode !== 'source_list') {
    throw new Error('org_all vector scope is not implemented by the Hub');
  }
  const sourceIds = canonicalizeBrainVectorSourceIds(input.filters.sourceIds);
  if (sourceIds.length === 0 || sourceIds.length > BRAIN_VECTOR_MAX_SOURCE_IDS) {
    throw new Error(`Vector search requires 1-${BRAIN_VECTOR_MAX_SOURCE_IDS} scoped sources`);
  }
  if (
    input.vector.length !== EMBEDDING_DIMENSIONS ||
    !input.vector.every(Number.isFinite) ||
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > BRAIN_VECTOR_MAX_CANDIDATES
  ) {
    throw new Error('Vector search dimensions or limit are invalid');
  }
  if (
    input.filters.kinds !== undefined &&
    (input.filters.kinds.length > BRAIN_VECTOR_MAX_KINDS ||
      input.filters.kinds.some(
        (kind) => kind.length === 0 || kind.length > BRAIN_VECTOR_MAX_KIND_LENGTH,
      ))
  ) {
    throw new Error('Vector search kinds are invalid');
  }
  if (!isUtcInstant(input.filters.occurredAfter) || !isUtcInstant(input.filters.occurredBefore)) {
    throw new Error('Vector search dates must be RFC 3339 UTC instants ending in Z');
  }
  const token = await mintBrainVectorCapability(config, { ...input, sourceIds });
  const baseUrl = config.url.endsWith('/') ? config.url : `${config.url}/`;
  const response = await fetchImpl(new URL('v1/search', baseUrl), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contractVersion: BRAIN_VECTOR_CONTRACT_VERSION,
      generation: config.generation,
      vector: input.vector,
      limit: input.limit,
      filters: { ...input.filters, scopeMode: 'source_list', sourceIds },
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Vector API search failed (${response.status})`);
  }
  return parseResponse(await response.json(), config.generation, input.limit);
}
