/**
 * Typed RPC wrapper for `myAgent.*` gateway methods.
 *
 * Thin convenience layer over `sendRequest` from `./gateway.svelte` — mirrors
 * the pattern in `prompt-sections-rpc.ts`. The hub `/my-agent` canvas calls
 * `getFeedToday()` after the WS connection is up to populate its feed.
 *
 * Frame types live inline here for now. A later PR promotes them to
 * `@minion-stack/shared` so the gateway and hub agree on the wire shape
 * via a single source of truth.
 */

import { sendRequest } from './gateway.svelte';

export type ObservationDirection = 'inbound' | 'outbound';

export interface ObservationRow {
  id: number;
  userId: string;
  direction: ObservationDirection;
  channel: string;
  accountId: string | null;
  chatId: string | null;
  senderId: string | null;
  isGroup: boolean | null;
  agentId: string | null;
  sessionKey: string | null;
  contentPreview: string | null;
  messageId: string | null;
  observedAt: number;
  createdAt: number;
}

export interface FeedTodayResponse {
  observations: ObservationRow[];
  sinceMs: number;
  total: number;
}

/**
 * Recent observations for the authenticated user.
 *
 * @param sinceMs - earliest observed_at to include (defaults gateway-side to 24h ago)
 * @param limit   - max rows (gateway default 200, capped 1000)
 */
export async function getFeedToday(
  opts: { sinceMs?: number; limit?: number } = {},
): Promise<FeedTodayResponse> {
  const params: Record<string, number> = {};
  if (opts.sinceMs !== undefined) params.sinceMs = opts.sinceMs;
  if (opts.limit !== undefined) params.limit = opts.limit;
  return (await sendRequest('myAgent.feedToday', params)) as FeedTodayResponse;
}
