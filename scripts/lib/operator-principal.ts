import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
// Erased at runtime: no application alias or value graph before admission.
import type { QualifiedOperatorTarget } from '../../src/server/services/pos/accounts/audit.types';

export type { QualifiedOperatorTarget };

export type VerifiedOperatorPrincipal = Readonly<{
  profileId: string;
  authProject: string;
  verifiedAt: string;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Credential-free refusal; messages never carry tokens, keys or SDK headers. */
export class OperatorPrincipalError extends Error {
  constructor(readonly reason: string) {
    super(`operator principal refused: ${reason}`);
    this.name = 'OperatorPrincipalError';
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Stable credential-free identity of a database endpoint; username, password, query and fragment never contribute. */
export function operatorDatabaseIdentity(connectionUrl: string, authProject: string): string {
  let url: URL;
  try {
    url = new URL(connectionUrl);
  } catch {
    throw new OperatorPrincipalError('unparseable database url');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new OperatorPrincipalError('database url must be postgres/postgresql');
  }
  const path = url.pathname.slice(1);
  if (!path || path.includes('/')) throw new OperatorPrincipalError('database name required');
  if (!authProject) throw new OperatorPrincipalError('auth project required');
  const host = url.hostname.toLowerCase();
  const identity = {
    version: 1,
    protocol: 'postgresql',
    host,
    port: url.port ? Number(url.port) : 5432,
    database: decodeURIComponent(path),
    transport: LOOPBACK.has(host) ? 'local-marked-plaintext' : 'tls-verify-full',
    authProject,
  };
  return createHash('sha256').update(canonicalJson(identity), 'utf8').digest('hex');
}

/** Existing-session GoTrue verification against the qualified target only; no refresh, session or global fallback. */
export async function verifyOperatorPrincipal(
  input: Readonly<{
    accessToken: string;
    authUrl: string;
    anonKey: string;
    expectedProfileId: string;
    targetFingerprint: QualifiedOperatorTarget;
  }>,
): Promise<VerifiedOperatorPrincipal> {
  const { accessToken, authUrl, anonKey, expectedProfileId, targetFingerprint } = input;
  if (!accessToken || !anonKey) throw new OperatorPrincipalError('missing credential');
  if (!UUID.test(expectedProfileId))
    throw new OperatorPrincipalError('expected profile must be a canonical uuid');
  if (!targetFingerprint?.authProject || authUrl !== targetFingerprint.authUrl) {
    throw new OperatorPrincipalError('auth url does not match the qualified target');
  }
  let parsed: URL;
  try {
    parsed = new URL(authUrl);
  } catch {
    throw new OperatorPrincipalError('auth url is invalid');
  }
  const loopback = LOOPBACK.has(parsed.hostname.toLowerCase());
  if (
    (parsed.protocol !== 'https:' && !(loopback && parsed.protocol === 'http:')) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new OperatorPrincipalError('auth url must be plain https (or loopback)');
  }
  const client = createClient(authUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let userId: string | undefined;
  try {
    // getUser round-trips to GoTrue, so revoked/expired sessions are refused (getClaims would trust the JWT locally).
    const { data, error } = await client.auth.getUser(accessToken);
    if (error) throw new OperatorPrincipalError('token rejected');
    userId = data.user?.id;
  } catch (error) {
    if (error instanceof OperatorPrincipalError) throw error;
    throw new OperatorPrincipalError('verifier unavailable');
  }
  if (!userId || !UUID.test(userId) || userId !== expectedProfileId) {
    throw new OperatorPrincipalError('subject does not match the approved actor');
  }
  return Object.freeze({
    profileId: userId,
    authProject: targetFingerprint.authProject,
    verifiedAt: new Date().toISOString(),
  });
}
