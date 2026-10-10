/**
 * Client-side "edge-case alert" events — the owner asked to monitor the gaps
 * that don't show up in a normal funnel: a search that comes back empty, a
 * form the user chose to discard, a service removal the UI blocked, a URL
 * write storm, a deploy that stranded a tab on a stale chunk. PostHog alerts
 * are configured on insights built over these event names, so the set is
 * fixed (see `HubEvent`) rather than free text — a renamed/typo'd event is a
 * silent monitoring gap, not a flexible one.
 *
 * Naming: snake_case, noun then verb-past (`form_discard_confirmed`, not
 * `confirm_form_discard`) — matches server event naming in
 * `$server/observability-context.ts`.
 *
 * Fire-and-forget: never throws, never awaited, no-op in desktop builds and
 * whenever PostHog hasn't loaded yet (it's lazy-loaded off the boot path in
 * `hooks.client.ts`, so `window.posthog` is legitimately absent early on —
 * that's a skip, not an error).
 */
export type HubEvent =
  | 'customer_search_no_results'
  | 'form_discard_prompted'
  | 'form_discard_confirmed'
  | 'visit_service_added'
  | 'visit_service_removed'
  | 'visit_service_remove_blocked'
  | 'visit_service_separated'
  | 'calendar_url_replace_coalesced'
  | 'app_chunk_reload';

declare global {
  interface Window {
    posthog?: { capture: (event: string, properties?: Record<string, unknown>) => unknown };
  }
}

export function track(
  event: HubEvent,
  props?: Record<string, string | number | boolean | null>,
): void {
  if (import.meta.env.VITE_DESKTOP) return;
  try {
    window.posthog?.capture(event, props);
  } catch {
    // Monitoring must never turn into a user-facing failure.
  }
}
