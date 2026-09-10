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
 *   accepted as correlation hints ONLY, after charset/length validation. They
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
const TRACEPARENT_RE = /^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/;
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

/** Property keys whose VALUE is never safe to ship, whatever it holds. */
const SENSITIVE_KEY_RE =
  /(token|secret|password|passwd|cookie|auth|apikey|api_key|credential|session|email|phone|sql|query|statement|body|payload|dsn|bearer|message|stack|raw|name)/i;
/** Values that look like a credential, an address or a statement, whatever key carries them. */
const SENSITIVE_VALUE_RE =
  /(eyJ[\w-]{6,}|bearer\s+\S+|sk-[A-Za-z0-9_-]{8,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\b(?:select|insert|update|delete|drop|alter)\b[\s\S]*\b(?:from|into|table|set|where)\b)/i;

/** Snake_case identifiers only — anything else is a caller mistake, so drop it. */
const PROPERTY_KEY_RE = /^[a-z][a-z0-9_]*$/;
const MAX_STRING_LENGTH = 256;
const MAX_PROPERTIES = 48;
const MAX_CAUSE_DEPTH = 4;

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
 * Build the identity envelope for one request. Pure, total, never throws —
 * it runs on the error path, where a second failure would mask the first.
 */
export function requestIdentity(input: RequestIdentityInput): ObservabilityIdentity {
  const routeId = input.routeId;
  const method = typeof input.method === 'string' ? input.method.toUpperCase() : '';
  const traceparent = header(input, 'traceparent') ?? '';
  const traceMatch = TRACEPARENT_RE.exec(traceparent.trim());
  const traceId = traceMatch?.[1];
  const requestId =
    opaque(header(input, 'x-vercel-id')) ?? opaque(header(input, 'x-request-id')) ?? UNKNOWN;

  return {
    ...releaseContext(),
    route: typeof routeId === 'string' && ROUTE_ID_RE.test(routeId) ? routeId : '[unmatched]',
    method: HTTP_METHODS.has(method) ? method : UNKNOWN,
    // Server-resolved only. A header can never claim a tenant or an actor.
    org_id: opaque(input.locals?.orgId) ?? opaque(input.locals?.tenantCtx?.tenantId),
    actor_id: opaque(input.locals?.user?.id),
    request_id: requestId,
    trace_id: traceId && traceId !== ZERO_TRACE_ID && TRACE_ID_RE.test(traceId) ? traceId : UNKNOWN,
    // Correlation hint stamped by an agent producer; see 16-PRODUCER-MATRIX.md.
    agent_run_id: opaque(header(input, 'x-minion-run-id')),
  };
}

/** Attribution key for a capture client. Opaque, never an email or a name. */
export function distinctIdFor(identity: ObservabilityIdentity): string {
  if (identity.org_id) return `org:${identity.org_id}`;
  if (identity.actor_id) return `user:${identity.actor_id}`;
  return 'server';
}

/**
 * Filter an open-shaped property bag down to safe scalars. Used for metric
 * events whose keys are produced by hub code but whose values may embed
 * request-derived data. Anything not provably safe is dropped, not truncated.
 */
export function sanitizeEventProperties(
  properties: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!properties || typeof properties !== 'object') return out;
  for (const [key, value] of Object.entries(properties)) {
    if (Object.keys(out).length >= MAX_PROPERTIES) break;
    if (!PROPERTY_KEY_RE.test(key) || SENSITIVE_KEY_RE.test(key)) continue;
    if (value === null || typeof value === 'boolean') {
      out[key] = value;
      continue;
    }
    if (typeof value === 'number') {
      if (Number.isFinite(value)) out[key] = value;
      continue;
    }
    if (typeof value === 'string') {
      if (value.length > MAX_STRING_LENGTH || SENSITIVE_VALUE_RE.test(value)) continue;
      out[key] = value;
      continue;
    }
    // Objects, arrays, functions, symbols, bigints and undefined: dropped.
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
    // sha-256/16 of the message: correlatable, not reversible to content.
    error_digest: createHash('sha256').update(message, 'utf8').digest('hex').slice(0, 16),
    error_length: message.length,
    error_cause_chain: causeChain.join('>'),
  };
}
