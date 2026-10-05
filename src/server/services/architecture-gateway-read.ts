import { getPgClient } from '$server/db/pg-pool';

export interface ArchitectureGatewayRow {
  id: string;
  name: string;
  url: string;
  legacyServerId: string | null;
  lastConnectedAt: Date | null;
}

export class ArchitectureGatewayReadLimitError extends Error {
  constructor() {
    super('Architecture gateway projection exceeds its bound');
    this.name = 'ArchitectureGatewayReadLimitError';
  }
}

export const ARCHITECTURE_GATEWAY_QUERY = `
  select id::text,
    case when octet_length(name)<=512 then name else null end as name,
    case when octet_length(url)<=16384 then url else null end as url,
    case
      when legacy_server_id is null then null
      when octet_length(legacy_server_id)<=256 then legacy_server_id
      else null
    end as "legacyServerId",
    last_connected_at as "lastConnectedAt",
    (
      octet_length(name)>512 or octet_length(url)>16384 or
      (legacy_server_id is not null and octet_length(legacy_server_id)>256)
    ) as "fieldOverflow"
  from public.gateway
  where org_id=$1::uuid
  order by created_at,id
  limit 2001
`;

function requiredString(value: unknown, max = 512): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new Error('Invalid architecture gateway');
  }
  return value;
}

function optionalDate(value: unknown): Date | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value : new Date(requiredString(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error('Invalid architecture gateway');
  return parsed;
}

/** Internal architecture projection; never reused by public gateway list surfaces. */
export async function listArchitectureGateways(
  orgId: string,
  signal: AbortSignal,
): Promise<ArchitectureGatewayRow[]> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  return getPgClient().begin('read only', async (tx) => {
    await tx`select set_config('statement_timeout','4s',true)`;
    const rows = await tx.unsafe<
      Array<{
        id: unknown;
        name: unknown;
        url: unknown;
        legacyServerId: unknown;
        lastConnectedAt: unknown;
        fieldOverflow: unknown;
      }>
    >(ARCHITECTURE_GATEWAY_QUERY, [orgId]);
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (rows.length > 2000 || rows.some((row) => row.fieldOverflow !== false)) {
      throw new ArchitectureGatewayReadLimitError();
    }
    return rows.map((row) => ({
      id: requiredString(row.id),
      name: requiredString(row.name),
      url: requiredString(row.url, 16_384),
      legacyServerId: row.legacyServerId === null ? null : requiredString(row.legacyServerId, 256),
      lastConnectedAt: optionalDate(row.lastConnectedAt),
    }));
  });
}
