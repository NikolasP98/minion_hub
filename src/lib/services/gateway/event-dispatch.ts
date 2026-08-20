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
  if (isThenable(result)) {
    void Promise.resolve(result).catch((error: unknown) => reportHandlerFailure(frame, error));
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === 'function'
  );
}

function reportHandlerFailure(frame: DispatchableFrame, error: unknown): void {
  const event = typeof frame.event === 'string' && frame.event ? frame.event : 'unknown';
  const seq = typeof frame.seq === 'number' ? `, seq=${frame.seq}` : '';
  console.error(`${EVENT_HANDLER_FAILURE_PREFIX} (event=${event}${seq})`, error);
}
