import type { Transaction, Value } from '@libsql/client';
import {
  computeInsightsFromRows,
  type InsightEventRow,
  type InsightsResult,
} from './insights.service';
import { requireTelemetryScope } from './reliability-telemetry-read';

const DAY_MS = 86_400_000;
const MAX_INPUT_ROWS = 100_000;
const MAX_DIMENSION = 512;
const MAX_MESSAGE = 16_384;

function text(value: Value, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid insight row');
  return value;
}

function safeInteger(value: Value): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid insight row');
  }
  return value;
}

function tokens(metadata: string | null, event: string): number | null {
  if (event !== 'agent.llm.usage') return null;
  if (metadata === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(metadata) as unknown;
  } catch {
    throw new Error('Invalid insight metadata');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid insight metadata');
  }
  const tokenValue = (raw as { tokens?: unknown }).tokens;
  if (!tokenValue || typeof tokenValue !== 'object' || Array.isArray(tokenValue)) return null;
  const total = (tokenValue as { total?: unknown }).total;
  if (total === undefined || total === null) return null;
  if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) {
    throw new Error('Invalid insight token total');
  }
  return total;
}

async function materializeWindow(
  tx: Transaction,
  scope: { tenantId: string; serverId: string },
  from: number,
  to: number,
  toInclusive: boolean,
): Promise<InsightEventRow[]> {
  const result = await tx.execute({
    sql: `
			select
				substr(event,1,513) as event,
				substr(category,1,513) as category,
				substr(severity,1,513) as severity,
				substr(message,1,16385) as message,
				occurred_at as occurredAt,
				case when agent_id is null then null else substr(agent_id,1,513) end as agentId,
				case when metadata is null then null else substr(metadata,1,16385) end as metadata
			from unified_events
			where tenant_id = ? and server_id = ? and occurred_at >= ?
				and occurred_at ${toInclusive ? '<=' : '<'} ?
			order by occurred_at,id
			limit ?
		`,
    args: [scope.tenantId, scope.serverId, from, to, MAX_INPUT_ROWS + 1],
  });
  if (result.rows.length > MAX_INPUT_ROWS) throw new Error('Reliability input cap exceeded');
  return result.rows.map((raw) => {
    const row = raw as Record<string, Value>;
    const event = text(row.event, MAX_DIMENSION);
    const metadata = row.metadata === null ? null : text(row.metadata, MAX_MESSAGE);
    return {
      event,
      category: text(row.category, MAX_DIMENSION),
      severity: text(row.severity, MAX_DIMENSION),
      message: text(row.message, MAX_MESSAGE),
      occurredAt: safeInteger(row.occurredAt),
      agentId: row.agentId === null ? null : text(row.agentId, MAX_DIMENSION),
      tokens: tokens(metadata, event),
    };
  });
}

export async function readReliabilityInsights(
  tx: Transaction,
  legacyServerId: string | null,
  window: { from: number; to: number },
): Promise<InsightsResult> {
  const scope = await requireTelemetryScope(tx, legacyServerId);
  const duration = window.to - window.from;
  const current = await materializeWindow(tx, scope, window.from, window.to, true);
  const prior = await materializeWindow(
    tx,
    scope,
    Math.max(0, window.from - duration),
    window.from,
    false,
  );
  const fixed = await materializeWindow(
    tx,
    scope,
    Math.max(0, window.to - 8 * DAY_MS),
    window.to,
    true,
  );
  return computeInsightsFromRows({ current, prior, fixed }, window);
}
