/**
 * State module for the reliability/insights tab.
 *
 * Unlike the other reliability tabs (which stream live aggregates from the gateway
 * over WS), insights are HISTORICAL analysis over the hub's own `unified_events`
 * copy — so this reads a plain hub API route (`/api/reliability/insights`) and does
 * NOT need `conn.connected` gating. It works even when the gateway WS is down.
 */
import { createAsyncResource, messageError } from '../async.svelte';
import type { InsightsResult } from '$server/services/insights.service';

export type { InsightsResult } from '$server/services/insights.service';
export type { ProposedAction, DetectorKind } from '$server/services/insights.service';

export function createInsightsState() {
  const resource = createAsyncResource<InsightsResult, [string, number, number]>(
    async (serverId: string, from: number, to: number) => {
      const params = new URLSearchParams({ serverId, from: String(from), to: String(to) });
      const res = await fetch(`/api/reliability/insights?${params}`);
      if (!res.ok) throw new Error(`insights ${res.status}`);
      const body = (await res.json()) as { insights: InsightsResult | null };
      if (!body.insights) throw new Error('no insights');
      return body.insights;
    },
    { initialLoading: true, formatError: messageError },
  );

  return {
    get snapshot() {
      return resource.data;
    },
    get loading() {
      return resource.loading;
    },
    get error() {
      return resource.error;
    },
    load: resource.load,
  };
}
