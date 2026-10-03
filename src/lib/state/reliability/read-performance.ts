import { number, numbers, record, rows, string } from './decode-primitives';
import type { PerfSeries, PerfSnapshot } from './types';

export function decodePerfSnapshot(raw: unknown): PerfSnapshot {
  const data = record(raw);
  const errorRate = number(data.errorRate);
  if (errorRate > 1) throw new Error('Invalid reliability error rate');
  return {
    ...numbers(data, ['ts', 'windowMs', 'requests', 'throughputPerSec']),
    errorRate,
    latencyMs: numbers(data.latencyMs, ['p50', 'p95', 'p99', 'max']),
    eventLoopDelayMs: numbers(data.eventLoopDelayMs, ['mean', 'p50', 'p99', 'max']),
    slowestMethods: rows(
      data.slowestMethods,
      (raw) => {
        const row = record(raw);
        return {
          method: string(row.method),
          ...numbers(row, ['count', 'errors', 'p50', 'p95', 'max']),
        };
      },
      256,
    ),
  };
}

export function decodePerf(raw: unknown): PerfSeries {
  const data = record(raw);
  return {
    snapshots: rows(data.snapshots, decodePerfSnapshot, 5000),
    latest: data.latest === null ? null : decodePerfSnapshot(data.latest),
  };
}
