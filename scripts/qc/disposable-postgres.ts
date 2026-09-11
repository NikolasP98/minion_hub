import postgres from 'postgres';

/** This marker is set only by the owner of the disposable fixture database. */
export const DISPOSABLE_DATABASE_MARKER = 'minion-360-disposable:v1';

/** Validate before creating a client. Never fall back to application environment files. */
export function validateDisposableDatabaseUrl(
  raw: string | undefined,
  enabled: string | undefined,
) {
  if (enabled !== '1' || !raw) {
    throw new Error('Explicit MINION_QC_DISPOSABLE=1 and MINION_QC_DATABASE_URL are required');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid disposable database URL');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.port ||
    url.search ||
    url.hash ||
    url.username !== 'minion_qc' ||
    !/^\/minion_qc_[a-z0-9_]+$/.test(url.pathname)
  ) {
    throw new Error(
      'Disposable database must use an explicit loopback port, minion_qc owner and named fixture database',
    );
  }
  return url;
}

export async function openDisposablePostgres(
  environment: {
    MINION_QC_DISPOSABLE?: string;
    MINION_QC_DATABASE_URL?: string;
  } = process.env,
) {
  const url = validateDisposableDatabaseUrl(
    environment.MINION_QC_DATABASE_URL,
    environment.MINION_QC_DISPOSABLE,
  );
  const connections: ReturnType<typeof postgres>[] = [];
  function createConnection(fixtureSchema?: string) {
    if (fixtureSchema !== undefined && !/^qc_job_stock_[a-f0-9]{32}$/.test(fixtureSchema)) {
      throw new Error('Invalid disposable fixture schema');
    }
    const connection = postgres(url.href, {
      max: 1,
      prepare: false,
      connect_timeout: 3,
      idle_timeout: 5,
      connection: {
        application_name: 'minion-360-disposable',
        statement_timeout: 15_000,
        ...(fixtureSchema ? { search_path: `${fixtureSchema},pg_catalog` } : {}),
      },
    });
    connections.push(connection);
    return connection;
  }
  const close = async () => {
    await Promise.all(connections.map((connection) => connection.end({ timeout: 5 })));
  };
  const owner = createConnection();
  try {
    const [identity] = await owner<
      {
        database: string;
        owner: string;
        marker: string | null;
        version: string;
        address: string;
      }[]
    >`SELECT current_database() AS database, current_user AS owner,
      shobj_description(oid, 'pg_database') AS marker,
      current_setting('server_version') AS version,
      host(inet_server_addr()) AS address
      FROM pg_database WHERE datname=current_database()`;
    if (
      !identity ||
      identity.database !== url.pathname.slice(1) ||
      identity.owner !== 'minion_qc' ||
      identity.marker !== DISPOSABLE_DATABASE_MARKER ||
      !['127.0.0.1', '::1'].includes(identity.address)
    ) {
      throw new Error(
        'Disposable PostgreSQL identity/marker check failed; no fixtures were created',
      );
    }
    return { owner, createConnection, close, identity };
  } catch (error) {
    await close();
    // Do not include a driver exception or URL: either can contain credentials.
    throw new Error('Disposable PostgreSQL identity could not be established', {
      cause:
        error instanceof Error && error.message.startsWith('Disposable PostgreSQL identity/')
          ? error
          : undefined,
    });
  }
}
