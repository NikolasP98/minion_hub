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

/**
 * Upcoming calendar event surfaced in the feed. Mirrors the gateway
 * `CalendarItem` (personal-agent/sources/calendar-puller.ts).
 */
export interface CalendarItem {
  id: string;
  /** Which linked Google identity surfaced this event. */
  sourceEmail: string;
  title: string;
  /** ISO start — dateTime (timed) or date (all-day). */
  startsAt: string;
  /** ISO end. */
  endsAt: string;
  isAllDay: boolean;
  location: string | null;
  /** Google Calendar web href. */
  htmlLink: string | null;
  /** True for recurring (repeating) events, false/undefined for one-offs. */
  recurring?: boolean;
  /** The authenticated user's RSVP state, when they're an attendee. */
  responseStatus?: 'accepted' | 'declined' | 'tentative' | 'needsAction' | null;
}

/**
 * Unread inbox email surfaced in the feed. Mirrors the gateway
 * `EmailItem` (personal-agent/sources/email-puller.ts).
 */
export interface EmailItem {
  id: string;
  /** Which linked Google identity surfaced this message. */
  sourceEmail: string;
  /** Raw `From` header — `"Display Name <addr>"`. */
  from: string;
  /** Display name parsed from `from`, or the bare address. */
  fromName: string;
  subject: string;
  /** Raw RFC 2822 `Date` header. */
  date: string;
  /** ISO timestamp parsed from `date`; null when unparseable. */
  receivedAt: string | null;
  /** Gmail web deep-link. */
  htmlLink: string;
  /**
   * Whether the message is unread. The feed currently pulls `is:unread` only,
   * so this is effectively always true server-side; kept optional so the card
   * can render read/unread envelopes once the puller widens its query.
   */
  unread?: boolean;
  /** Short preview snippet, when the puller can supply one. */
  snippet?: string | null;
}

export interface FeedTodayResponse {
  observations: ObservationRow[];
  /** Upcoming events (next 24h) across linked Google calendars. */
  calendarItems: CalendarItem[];
  /** Unread inbox emails across linked Google identities. */
  emailItems: EmailItem[];
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
  const res = (await sendRequest('myAgent.feedToday', params)) as Partial<FeedTodayResponse>;
  // Default the Google-sourced arrays so an older gateway (pre calendar/email
  // pullers) or a partial response can't crash the consumer.
  return {
    observations: res.observations ?? [],
    calendarItems: res.calendarItems ?? [],
    emailItems: res.emailItems ?? [],
    sinceMs: res.sinceMs ?? 0,
    total: res.total ?? res.observations?.length ?? 0,
  };
}
