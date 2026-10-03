import type { Transaction, Value } from '@libsql/client';
import type { CredentialHealthReadQuery } from './reliability-read-query';
import { RELIABILITY_RESPONSE_MAX_BYTES } from './reliability-read-response';
import { requireTelemetryScope } from './reliability-telemetry-read';

interface SnapshotMeta {
  id: number;
  bytes: number;
}

function integer(value: Value): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid credential snapshot');
  }
  return value;
}

export async function readCredentialHealthSnapshots(
  tx: Transaction,
  legacyServerId: string | null,
  query: CredentialHealthReadQuery,
) {
  const scope = await requireTelemetryScope(tx, legacyServerId);
  const metadata = await tx.execute({
    sql: `
			select id,length(cast(snapshot_json as blob)) as bytes
			from credential_health_snapshots
			where tenant_id=? and server_id=? and captured_at>=? and captured_at<=?
			order by captured_at desc,id desc
			limit ?
		`,
    args: [scope.tenantId, scope.serverId, query.from, query.to, query.limit],
  });
  const selected: SnapshotMeta[] = metadata.rows.map((raw) => {
    const row = raw as Record<string, Value>;
    return { id: integer(row.id), bytes: integer(row.bytes) };
  });
  if (
    selected.some((row) => row.bytes > RELIABILITY_RESPONSE_MAX_BYTES) ||
    selected.reduce((sum, row) => sum + row.bytes, 0) > RELIABILITY_RESPONSE_MAX_BYTES
  ) {
    throw new Error('Credential snapshot response cap exceeded');
  }
  if (selected.length === 0) return [];
  const placeholders = selected.map(() => '?').join(',');
  const result = await tx.execute({
    sql: `
			select id,server_id as serverId,snapshot_json as snapshotJson,
				captured_at as capturedAt,created_at as createdAt
			from credential_health_snapshots
			where id in (${placeholders})
			order by captured_at desc,id desc
		`,
    args: selected.map((row) => row.id),
  });
  if (result.rows.length !== selected.length) throw new Error('Credential snapshot changed');
  return result.rows.map((raw) => {
    const row = raw as Record<string, Value>;
    if (row.serverId !== scope.serverId || typeof row.snapshotJson !== 'string') {
      throw new Error('Credential snapshot owner mismatch');
    }
    return {
      id: integer(row.id),
      tenantId: scope.tenantId,
      serverId: scope.serverId,
      snapshotJson: row.snapshotJson,
      capturedAt: integer(row.capturedAt),
      createdAt: integer(row.createdAt),
    };
  });
}
