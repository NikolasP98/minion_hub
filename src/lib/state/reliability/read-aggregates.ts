import { number, numbers, record, rows, string } from './decode-primitives';
import type { ActivityAggregate, UsageAggregate } from './types';

const usageTotals = ['input', 'output', 'cacheRead', 'total', 'costMicroUsd'] as const;
const outcomes = ['ok', 'error', 'timeout', 'authError'] as const;

export function decodeUsage(raw: unknown): UsageAggregate {
  const data = record(raw);
  return {
    buckets: rows(data.buckets, (raw) => {
      const row = record(raw);
      return {
        ...numbers(row, [...usageTotals, 'calls']),
        model: string(row.model),
        provider: string(row.provider),
        channel: string(row.channel),
        source: string(row.source),
        agentId: string(row.agentId),
      };
    }),
    timeline: rows(data.timeline, (row) => numbers(row, [...usageTotals, 't'])),
    total: numbers(data.total, [...usageTotals, 'calls']),
    eventCount: number(data.eventCount),
    generatedAt: number(data.generatedAt),
  };
}

function dimension(raw: unknown) {
  const row = record(raw);
  return { key: string(row.key), value: number(row.value) };
}

export function decodeActivity(raw: unknown): ActivityAggregate {
  const data = record(raw);
  const memory = record(data.memory),
    heartbeat = record(data.heartbeat),
    tools = record(data.tools);
  const breakdown = data.toolOutcomes === undefined ? undefined : record(data.toolOutcomes);
  return {
    memory: {
      ...numbers(memory, ['created', 'updated', 'deleted', 'total', 'lastTs']),
      ...(memory.reads === undefined ? {} : { reads: number(memory.reads) }),
      byType: rows(memory.byType, dimension),
    },
    heartbeat: {
      ...numbers(heartbeat, ['ok', 'failed', 'skipped', 'sent', 'total', 'lastTs']),
      lastStatus: string(heartbeat.lastStatus),
    },
    tools: { ...numbers(tools, ['ok', 'err', 'total']), top: rows(tools.top, dimension) },
    ...(breakdown === undefined
      ? {}
      : {
          toolOutcomes: {
            ...numbers(breakdown, [...outcomes, 'total']),
            byTool: rows(breakdown.byTool, (raw) => {
              const row = record(raw);
              return { tool: string(row.tool), ...numbers(row, outcomes) };
            }),
          },
        }),
    proactivity: numbers(data.proactivity, [
      'proactive',
      'reactive',
      'interAgent',
      'other',
      'total',
    ]),
    generatedAt: number(data.generatedAt),
  };
}
