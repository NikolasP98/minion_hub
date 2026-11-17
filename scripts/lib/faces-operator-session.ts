/**
 * Shared admission for the F1 write-capable operator wrappers (mapping, garment): private env, database identity,
 * env-trusted token destination, GoTrue verification, then (and only then) the closed service loader and ONE pooled
 * connection. Preview/apply/status still own their transactions inside the services; this opens no transaction.
 */
import {
  operatorDatabaseIdentity,
  verifyOperatorPrincipal,
  type QualifiedOperatorTarget,
} from './operator-principal';

export class SessionRefusal extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'SessionRefusal';
  }
}

export async function openOperatorSession(input: {
  env: NodeJS.ProcessEnv;
  target: QualifiedOperatorTarget;
  actorProfileId: string;
  orgId: string;
}) {
  const { env, target } = input;
  const url = env.FACES_STOCK_DATABASE_URL;
  const token = env.FACES_OPERATOR_ACCESS_TOKEN;
  const anonKey = env.FACES_OPERATOR_ANON_KEY;
  if (!url || !token || !anonKey) throw new SessionRefusal('missing_private_input');
  if (operatorDatabaseIdentity(url, target.authProject) !== target.databaseIdentity)
    throw new SessionRefusal('database_identity_mismatch');
  const principal = await verifyOperatorPrincipal({
    accessToken: token,
    authUrl: target.authUrl,
    trustedAuthUrl: env.FACES_OPERATOR_AUTH_URL,
    anonKey,
    expectedProfileId: input.actorProfileId,
    targetFingerprint: target,
  });
  const { createOperatorServiceLoader } = await import('./operator-service-loader');
  const loader = await createOperatorServiceLoader({ principal, target });
  const postgresModule = await import('postgres');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const pgPool = await loader.load('pgPool');
  const host = new URL(url).hostname;
  const remote = !['127.0.0.1', 'localhost', '[::1]'].includes(host);
  const client = postgresModule.default(url, {
    max: 1,
    prepare: false,
    fetch_types: false,
    types: pgPool.ARRAY_TYPES as unknown as Record<string, import('postgres').PostgresType>,
    ssl: remote ? { rejectUnauthorized: true, servername: host } : false,
    connection: { statement_timeout: 12_000, application_name: 'faces-stock-operator' },
  });
  const [ident] = await client`select current_database() as db`;
  if (ident?.db !== decodeURIComponent(new URL(url).pathname.slice(1))) {
    await client.end({ timeout: 5 });
    await loader.close();
    throw new SessionRefusal('connection_identity_mismatch');
  }
  return {
    principal,
    loader,
    ctx: { db: drizzle(client) as never, tenantId: input.orgId, profileId: principal.profileId },
    actor: { id: principal.profileId, name: 'faces-operator' },
    async close() {
      await client.end({ timeout: 5 });
      await loader.close();
    },
  };
}
