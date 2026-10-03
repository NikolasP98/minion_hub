import type { Transaction, Value } from '@libsql/client';

export const MAX_ARCHITECTURE_HEARTBEAT_TARGETS = 3;
export const MAX_ARCHITECTURE_CHANNEL_STATUS_BYTES = 16_384;

/**
 * One indexed lookup per admitted static gateway. The server/time index also
 * carries SQLite's rowid, so the reverse scan satisfies the id tie-break.
 */
export const LATEST_ARCHITECTURE_HEARTBEAT_QUERY = `
  select server_id as serverId,captured_at as capturedAt,uptime_ms as uptimeMs,
    active_sessions as activeSessions,memory_rss_mb as memoryRssMb,
    case
      when channel_status_json is null then null
      when length(cast(channel_status_json as blob))<=16384 then channel_status_json
      else null
    end as channelStatusJson,
    case
      when channel_status_json is null then 0
      when length(cast(channel_status_json as blob))>16384 then 1
      else 0
    end as channelStatusOverflow
  from gateway_heartbeats
  where server_id=?
  order by captured_at desc,id desc
  limit 1
`;

export async function readLatestArchitectureHeartbeatRows(
  tx: Transaction,
  serverIds: readonly string[],
): Promise<Array<Record<string, Value>>> {
  const unique = [...new Set(serverIds)];
  if (unique.length > MAX_ARCHITECTURE_HEARTBEAT_TARGETS) {
    throw new Error('Architecture heartbeat target limit exceeded');
  }
  const rows: Array<Record<string, Value>> = [];
  for (const serverId of unique) {
    const result = await tx.execute({
      sql: LATEST_ARCHITECTURE_HEARTBEAT_QUERY,
      args: [serverId],
    });
    if (result.rows[0]) rows.push(result.rows[0] as Record<string, Value>);
  }
  return rows;
}
