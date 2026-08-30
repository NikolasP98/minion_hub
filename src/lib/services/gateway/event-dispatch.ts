/**
 * Containment for hub's gateway event handler.
 *
 * `@minion-stack/shared` provides an `onEventError` fallback, but hub contains
 * failures at its own dispatch boundary first. This preserves useful event and
 * sequence context, reports exactly once through `console.error`, and keeps the
 * shared fallback as defense in depth for failures outside this boundary. See
 * `docs/2026-08-19-gateway-onevent-error-hook-adoption.md`.
 *
 * This module contains the failure at hub's own dispatch site and reports it
 * exactly once through `console.error`,
 * which `src/lib/utils/console-interceptor.ts` captures into the bug-report
 * buffer.
 *
 * Invariant (spec invariant 5): a handler failure is NOT a disconnection. The
 * only effect of a failure here is one `console.error` — connection-health state
 * (`conn.connected` / `connectErrorHint` / …) is deliberately untouched, and the
 * failure is never rethrown, so one bad event cannot abort the socket's message
 * loop or the frames that follow it.
 *
 * "Never rethrown" holds for the reporting path as well, not just the handler
 * call: a thrown value can be hostile to serialisation and the console can be
 * replaced, so `reportHandlerFailure` is itself total (see its doc comment).
 * Nothing that happens inside this module escapes it, synchronously or as an
 * unhandled rejection.
 */

/** Shape this module needs from a gateway event frame; a superset is fine. */
export interface DispatchableFrame {
  event?: unknown;
  seq?: unknown;
}

/** Prefix every containment report shares, so triage can grep one string. */
export const EVENT_HANDLER_FAILURE_PREFIX = '[gateway] onEvent handler failed';

/**
 * Run `handle(frame)`, containing and reporting whatever it throws or rejects
 * with. Returns immediately; an async failure is reported when it settles.
 */
export function dispatchGatewayEvent<F extends DispatchableFrame>(
  frame: F,
  handle: (frame: F) => unknown,
): void {
  let result: unknown;
  try {
    result = handle(frame);
  } catch (error) {
    reportHandlerFailure(frame, error);
    return;
  }

  // Assimilate every result so promise machinery performs the single
  // authoritative `.then` lookup. Pre-reading `.then` here would let a
  // stateful accessor change before Promise.resolve sees it and lose a late
  // rejection.
  try {
    void Promise.resolve(result).catch((error: unknown) => reportHandlerFailure(frame, error));
  } catch (error) {
    // Keep this boundary total even if the runtime's promise machinery itself
    // is replaced or otherwise behaves unexpectedly.
    reportHandlerFailure(frame, error);
  }
}

/**
 * Report one contained failure. Total: reporting a failure may never raise one.
 *
 * A handler can throw ANY value, and the value travels into `console.error` —
 * through the app's interceptor, which serialises it. A value engineered to
 * defeat serialisation (throwing `toJSON`/`toString`/`Symbol.toPrimitive`), or
 * a console replaced by something that throws, would otherwise turn this sink
 * into the escape hatch the whole module exists to close: the synchronous throw
 * would leave `dispatchGatewayEvent`, and the async one would surface as an
 * unhandled rejection from the `.catch` callback above.
 */
function reportHandlerFailure(frame: DispatchableFrame, error: unknown): void {
  try {
    const event = typeof frame.event === 'string' && frame.event ? frame.event : 'unknown';
    const seq = typeof frame.seq === 'number' ? `, seq=${frame.seq}` : '';
    console.error(`${EVENT_HANDLER_FAILURE_PREFIX} (event=${event}${seq})`, error);
  } catch {
    // The payload or the sink is hostile. Try once more with a constant-only
    // message so the failure is still visible, then give up silently: an
    // uncontained report is worse than a lost one.
    try {
      console.error(EVENT_HANDLER_FAILURE_PREFIX);
    } catch {
      // Nothing left to report through.
    }
  }
}
