/**
 * Sanitized execution identity for server telemetry (OBS-01).
 *
 * Every property that reaches a capture client (PostHog today) is built here,
 * from allowlisted server-side facts. The rules are deliberately narrow:
 *
 * - Identity is carried as OPAQUE IDS only — org id, actor id, request id,
 *   trace id, agent run id. Never emails, display names, tokens, cookies,
 *   headers, SQL text, request/response bodies or error messages.
 * - Route attribution uses the ROUTE TEMPLATE (`event.route.id`), never the
 *   concrete pathname: `/crm/customers/[id]` is safe, the resolved path is a
 *   customer identifier.
 * - Client-supplied correlation headers (traceparent, x-request-id) are
 *   hashed as correlation hints ONLY, after charset/length validation. They
 *   are never authority: org and actor come from server-resolved locals.
 * - Unknown attribution stays explicit (`'unknown'`). A release is never
 *   invented from NODE_ENV or a package version.
 *
 * Reads `process.env` directly (like `$lib/server/server-timing.ts`) so the
 * module is unit-testable without the SvelteKit `$env` shims. `src/hooks.server.ts`
 * hoists `.env` into `process.env` before any server module loads.
 */
import { createHash } from 'node:crypto';

/** Explicit "we do not know" — never replaced by a guess. */
export const UNKNOWN = 'unknown';

/** Opaque id shape: uuid, nanoid, vercel request id. No spaces, bounded. */
const OPAQUE_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const ROUTE_ID_RE = /^[A-Za-z0-9_/[\]().=+-]{1,256}$/;
const COMMIT_SHA_RE = /^[0-9a-f]{7,40}$/;
const TRACE_ID_RE = /^[0-9a-f]{32}$/;
const ZERO_TRACE_ID = '0'.repeat(32);
const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;
const HTTP_METHODS = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'TRACE',
  'CONNECT',
]);
const ENVIRONMENTS = new Set(['production', 'preview', 'development', 'test']);

/** Values that look like a credential, an address or a statement, whatever key carries them. */
const SENSITIVE_VALUE_RE =
  /(eyJ[\w-]{6,}|bearer\s+\S+|sk-[A-Za-z0-9_-]{8,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\b(?:select|insert|update|delete|drop|alter)\b[\s\S]*\b(?:from|into|table|set|where)\b)/i;

const MAX_CAUSE_DEPTH = 4;

/** Stable correlation pseudonym, not authentication or protection against guessing. */
export function correlationId(
  domain: 'request' | 'agent-run' | 'server' | 'agent',
  value: unknown,
): string | null {
  if (typeof value !== 'string' || !OPAQUE_ID_RE.test(value)) return null;
  return `sha256:${createHash('sha256').update(`minion.telemetry.${domain}\0`).update(value).digest('hex')}`;
}

function opaque(value: unknown): string | null {
  return typeof value === 'string' && OPAQUE_ID_RE.test(value) ? value : null;
}

/** Deployment attribution. Absent/malformed metadata stays `UNKNOWN`. */
export function releaseContext(): {
  environment: string;
  release: string;
  deployment_id: string;
  region: string;
} {
  const rawEnvironment =
    process.env.PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? '';
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? '';
  return {
    environment: ENVIRONMENTS.has(rawEnvironment) ? rawEnvironment : UNKNOWN,
    // A commit sha or nothing. npm_package_version / NODE_ENV are NOT releases.
    release: COMMIT_SHA_RE.test(sha) ? sha : UNKNOWN,
    deployment_id: opaque(process.env.VERCEL_DEPLOYMENT_ID) ?? UNKNOWN,
    region: opaque(process.env.VERCEL_REGION) ?? UNKNOWN,
  };
}

/** Structural subset of a SvelteKit `RequestEvent` — keeps this unit-testable. */
export interface RequestIdentityInput {
  routeId?: string | null;
  method?: string | null;
  headers?: { get(name: string): string | null } | null;
  locals?: {
    orgId?: string;
    user?: { id?: string } | null;
    tenantCtx?: { tenantId?: string } | null;
  } | null;
}

export interface ObservabilityIdentity {
  environment: string;
  release: string;
  deployment_id: string;
  region: string;
  route: string;
  method: string;
  org_id: string | null;
  actor_id: string | null;
  request_id: string;
  trace_id: string;
  agent_run_id: string | null;
}

function header(input: RequestIdentityInput, name: string): string | null {
  try {
    return input.headers?.get(name) ?? null;
  } catch {
    return null;
  }
}

/**
 * Build the envelope from SvelteKit-owned route/locals and bounded header hints.
 * Header getter failures are contained; route and locals are trusted server inputs.
 */
export function requestIdentity(input: RequestIdentityInput): ObservabilityIdentity {
  const routeId = input.routeId;
  const method = typeof input.method === 'string' ? input.method.toUpperCase() : '';
  const traceparent = header(input, 'traceparent') ?? '';
  const traceMatch = TRACEPARENT_RE.exec(traceparent.trim());
  const traceId = traceMatch?.[1];
  const requestId =
    correlationId('request', header(input, 'x-vercel-id')) ??
    correlationId('request', header(input, 'x-request-id')) ??
    UNKNOWN;

  return {
    ...releaseContext(),
    route: typeof routeId === 'string' && ROUTE_ID_RE.test(routeId) ? routeId : '[unmatched]',
    method: HTTP_METHODS.has(method) ? method : UNKNOWN,
    // Server-resolved only. A header can never claim a tenant or an actor.
    org_id: opaque(input.locals?.orgId) ?? opaque(input.locals?.tenantCtx?.tenantId),
    actor_id: opaque(input.locals?.user?.id),
    request_id: requestId,
    trace_id:
      traceId &&
      traceId !== ZERO_TRACE_ID &&
      traceMatch?.[2] !== '0'.repeat(16) &&
      TRACE_ID_RE.test(traceId)
        ? traceId
        : UNKNOWN,
    // Correlation hint stamped by an agent producer; see 16-PRODUCER-MATRIX.md.
    agent_run_id: correlationId('agent-run', header(input, 'x-minion-run-id')),
  };
}

/** Attribution key for a capture client. Opaque, never an email or a name. */
export function distinctIdFor(identity: ObservabilityIdentity): string {
  if (identity.org_id) return `org:${identity.org_id}`;
  if (identity.actor_id) return `user:${identity.actor_id}`;
  return 'server';
}

type Scalar = string | number | boolean | null;
type Rule = (value: unknown) => value is Scalar;
const token: Rule = (v): v is string =>
  typeof v === 'string' && OPAQUE_ID_RE.test(v) && !SENSITIVE_VALUE_RE.test(v);
const nullable =
  (rule: Rule): Rule =>
  (v): v is Scalar =>
    v === null || rule(v);
const oneOf =
  (...values: string[]): Rule =>
  (v): v is string =>
    typeof v === 'string' && values.includes(v);
const count: Rule = (v): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const duration: Rule = (v): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;
const hash: Rule = (v): v is string => typeof v === 'string' && /^sha256:[a-f0-9]{64}$/.test(v);
const unknownOr =
  (rule: Rule): Rule =>
  (v): v is Scalar =>
    v === UNKNOWN || rule(v);
const errorType: Rule = (v): v is string =>
  typeof v === 'string' &&
  /^(?:[A-Za-z][A-Za-z0-9]{0,58}Error|Error|null|undefined|string|object|number|boolean|symbol|bigint|function|unknown)$/.test(
    v,
  );
const fields: Record<string, Rule> = {
  environment: oneOf(...ENVIRONMENTS, UNKNOWN),
  release: unknownOr((v): v is string => typeof v === 'string' && COMMIT_SHA_RE.test(v)),
  commit_sha: nullable((v): v is string => typeof v === 'string' && COMMIT_SHA_RE.test(v)),
  deployment_id: nullable(
    unknownOr((v): v is string => typeof v === 'string' && /^dpl_[A-Za-z0-9_-]{1,124}$/.test(v)),
  ),
  region: nullable(
    unknownOr(
      (v): v is string =>
        typeof v === 'string' && /^[a-z]{2,12}[0-9](?:-[a-z0-9-]{1,20})?$/.test(v),
    ),
  ),
  // Trust boundary: callers must supply SvelteKit event.route.id. A character
  // check cannot distinguish a static route from a resolved customer path.
  route: (v): v is string =>
    typeof v === 'string' &&
    (v === '[unmatched]' || ROUTE_ID_RE.test(v)) &&
    !SENSITIVE_VALUE_RE.test(v),
  method: oneOf(...HTTP_METHODS, UNKNOWN),
  org_id: nullable(token),
  actor_id: nullable(token),
  request_id: unknownOr(hash),
  agent_run_id: nullable(hash),
  trace_id: unknownOr(
    (v): v is string => typeof v === 'string' && TRACE_ID_RE.test(v) && v !== ZERO_TRACE_ID,
  ),
  server_id: nullable(hash),
  agent_id: nullable(hash),
  status: (v): v is number =>
    typeof v === 'number' && Number.isInteger(v) && (v === 0 || (v >= 100 && v <= 599)),
  duration_ms: duration,
  request_ordinal: count,
  instance_age_ms: duration,
  sample_reason: oneOf('isolate+cache-miss', 'isolate-cold', 'cache-miss', 'slow', 'sampled-warm'),
  isolate_cold: (v): v is boolean => typeof v === 'boolean',
  cache_status: oneOf('none', 'hit', 'stale', 'miss', 'error'),
  cache_hits: count,
  cache_stale_hits: count,
  cache_misses: count,
  cache_errors: count,
  cache_lookup_ms: duration,
  db_transactions: count,
  db_acquire_ms: duration,
  db_setup_ms: duration,
  db_query_ms: duration,
  db_total_ms: duration,
  // Producer validates against the existing PHASES catalog; bound the wire type too.
  start_from: nullable((v): v is string => typeof v === 'string' && /^[0-9]{2}$/.test(v)),
  error_type: errorType,
  error_code: nullable(
    (v): v is string =>
      typeof v === 'string' &&
      /^(?:[A-Z0-9]{5}|E[A-Z][A-Z0-9_]{0,62}|ERR_[A-Z0-9_]{1,60})$/.test(v),
  ),
  error_digest: (v): v is string => typeof v === 'string' && /^[a-f0-9]{16}$/.test(v),
  error_length: count,
  error_cause_chain: (v): v is string =>
    typeof v === 'string' &&
    (v === '' || (v.split('>').length <= MAX_CAUSE_DEPTH && v.split('>').every(errorType))),
};
const identityFields = [
  'environment',
  'release',
  'deployment_id',
  'region',
  'route',
  'method',
  'org_id',
  'actor_id',
  'request_id',
  'trace_id',
  'agent_run_id',
];
const eventFields: Record<string, readonly string[]> = {
  server_error: [
    ...identityFields,
    'status',
    'error_type',
    'error_code',
    'error_digest',
    'error_length',
    'error_cause_chain',
  ],
  server_timing: [
    ...identityFields,
    'commit_sha',
    'status',
    'duration_ms',
    'sample_reason',
    'isolate_cold',
    'request_ordinal',
    'instance_age_ms',
    'cache_status',
    'cache_hits',
    'cache_stale_hits',
    'cache_misses',
    'cache_errors',
    'cache_lookup_ms',
    'db_transactions',
    'db_acquire_ms',
    'db_setup_ms',
    'db_query_ms',
    'db_total_ms',
  ],
  app_layout_slow_load: [...identityFields, 'duration_ms'],
  server_added: [...identityFields, 'server_id'],
  provision_run_started: [...identityFields, 'server_id', 'start_from'],
  agent_installed_from_marketplace: [...identityFields, 'server_id', 'agent_id'],
};

export function isServerEvent(event: unknown): event is string {
  return typeof event === 'string' && Object.hasOwn(eventFields, event);
}

/** Fixed key iteration bounds work and never evaluates accessor values. Unknown
 * events/fields are denied; the optional event selects a narrower producer profile. */
export function sanitizeEventProperties(
  properties: Record<string, unknown> | null | undefined,
  event?: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (
    !properties ||
    typeof properties !== 'object' ||
    (event !== undefined && !isServerEvent(event))
  )
    return out;
  for (const key of event === undefined ? Object.keys(fields) : eventFields[event]) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(properties, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) continue;
      const value: unknown = descriptor.value;
      if (fields[key](value)) out[key] = value;
    } catch {
      // A hostile proxy cannot make telemetry fail a request.
    }
  }
  return out;
}

function typeToken(value: unknown): string {
  const name =
    value instanceof Error
      ? (value.constructor?.name ?? 'Error')
      : value === null
        ? 'null'
        : typeof value;
  return OPAQUE_ID_RE.test(name) && name.length <= 64 ? name : UNKNOWN;
}

function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message ?? '';
  if (typeof value === 'string') return value;
  return '';
}

export interface ErrorEventInput {
  error: unknown;
  status?: number;
  identity: ObservabilityIdentity;
}

/**
 * Build the property bag for a server error event. The error MESSAGE never
 * ships — a message routinely carries SQL, tokens, customer rows or a whole
 * upstream response body. What ships instead is a stable digest of it, which
 * groups recurring errors without disclosing their content, plus the type
 * chain and the machine-readable `code` an app route set deliberately.
 */
export function sanitizeErrorProperties({
  error,
  status,
  identity,
}: ErrorEventInput): Record<string, unknown> {
  const message = messageOf(error);
  const causeChain: string[] = [];
  let cause: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    cause = cause instanceof Error ? cause.cause : undefined;
    if (cause === undefined || cause === null) break;
    causeChain.push(typeToken(cause));
  }
  const code =
    error && typeof error === 'object' && 'code' in error
      ? opaque((error as { code?: unknown }).code)
      : null;

  return {
    ...identity,
    status: typeof status === 'number' && Number.isFinite(status) ? status : 0,
    error_type: typeToken(error),
    error_code: code,
    // Correlation fingerprint only: low-entropy messages remain guessable.
    error_digest: createHash('sha256').update(message, 'utf8').digest('hex').slice(0, 16),
    error_length: message.length,
    error_cause_chain: causeChain.join('>'),
  };
}
