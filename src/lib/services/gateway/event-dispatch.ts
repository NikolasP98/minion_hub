/**
 * Containment for hub's gateway event handler.
 *
 * The shared `GatewayClient` dispatches with
 * `void Promise.resolve(this.opts.onEvent?.(frame)).catch(() => {})`
 * (`node_modules/@minion-stack/shared/dist/gateway/client.js`), which loses
 * handler failures two different ways: a SYNCHRONOUS throw happens while
 * evaluating `this.opts.onEvent?.(frame)`, i.e. before `Promise.resolve` can
 * wrap it, so it escapes into the socket's message handler as an uncaught
 * error; an ASYNCHRONOUS rejection lands in the empty `catch` and vanishes.
 *
 * `@minion-stack/shared`'s `onEventError` hook is the upstream fix for this, but
 * no published build declares it yet — see
 * `docs/2026-08-19-gateway-onevent-error-hook-adoption.md`. This module is the
 * part of that outcome hub owns and can ship today: it contains the failure at
 * hub's own dispatch site and reports it exactly once through `console.error`,
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

  // A handler that returns a thenable (today's `handleEvent` does not, but its
  // branches are free to become async) must not lose a late rejection either.
  try {
    if (isThenable(result)) {
      void Promise.resolve(result).catch((error: unknown) => reportHandlerFailure(frame, error));
    }
  } catch (error) {
    // Reading `.then` runs user code when the returned value has an accessor
    // there, and that read sits outside the call's own try. Contain it too.
    reportHandlerFailure(frame, error);
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === 'function'
  );
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
