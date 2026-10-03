import { createClient, type Transaction } from '@libsql/client';
import { env } from '$env/dynamic/private';

export class ReliabilityTelemetryTargetError extends Error {
  readonly status = 404;
  readonly code = 'telemetry_target_unavailable';
  constructor() {
    super('Reliability telemetry target unavailable');
    this.name = 'ReliabilityTelemetryTargetError';
  }
}

function combineSignals(signals: readonly (AbortSignal | null | undefined)[]): AbortSignal {
  const active = signals.filter(
    (signal): signal is AbortSignal => signal !== null && signal !== undefined,
  );
  if (active.length === 1) return active[0]!;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(active);
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener('abort', abort, { once: true });
  }
  return controller.signal;
}

/**
 * One owned read-only telemetry client and transaction. Aborting closes both;
 * callers retain their admission slot until the resulting work promise settles.
 */
export async function withOwnedTelemetryRead<T>(
  signal: AbortSignal,
  read: (tx: Transaction) => Promise<T>,
): Promise<T> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const client = createClient({
    url: env.TURSO_DB_URL ?? 'file:./data/minion_hub.db',
    ...(env.TURSO_DB_AUTH_TOKEN ? { authToken: env.TURSO_DB_AUTH_TOKEN } : {}),
    intMode: 'number',
    concurrency: 1,
    fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      const requestSignal = (input as { signal?: AbortSignal }).signal;
      return globalThis.fetch(input, {
        ...init,
        signal: combineSignals([signal, requestSignal, init?.signal]),
      });
    },
  });
  let tx: Transaction | null = null;
  const abort = () => {
    try {
      tx?.close();
    } finally {
      client.close();
    }
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    tx = await client.transaction('read');
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return await read(tx);
  } finally {
    signal.removeEventListener('abort', abort);
    try {
      tx?.close();
    } finally {
      client.close();
    }
  }
}

export async function requireTelemetryScope(
  tx: Transaction,
  legacyServerId: string | null,
): Promise<{ serverId: string; tenantId: string }> {
  if (!legacyServerId) throw new ReliabilityTelemetryTargetError();
  const result = await tx.execute({
    sql: 'select id, tenant_id as tenantId from servers where id = ? limit 2',
    args: [legacyServerId],
  });
  if (result.rows.length !== 1) throw new ReliabilityTelemetryTargetError();
  const row = result.rows[0] as Record<string, unknown>;
  if (row.id !== legacyServerId || typeof row.tenantId !== 'string' || !row.tenantId) {
    throw new ReliabilityTelemetryTargetError();
  }
  return { serverId: legacyServerId, tenantId: row.tenantId };
}
