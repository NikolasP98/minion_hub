// Separate from pg-pool so hooks.server.ts never pulls a new export out of a module
// that many tests mock with a partial shape.
export const IDLE_TIMEOUT_S = 20;

let idleHold: {
  promise: Promise<void>;
  resolve: () => void;
  timer?: ReturnType<typeof setTimeout>;
} | null = null;

/**
 * A promise that settles IDLE_TIMEOUT_S + 2 s after the LAST call in this process,
 * or null when no pool exists yet. Pass it to Vercel `waitUntil` after every
 * request: a frozen (suspended) isolate never runs postgres.js's idle timer, so
 * its sockets kept pooler client slots for minutes. 2026-11-03 and 2026-11-04:
 * one /scheduling/bookings visit (~750 parallel requests) left 200 slots held
 * ~5-11 min after the burst. `attachDatabasePool` does this for `pg`, not
 * postgres.js. Every request resets the timer, so one promise serves them all.
 */
export function holdUntilPoolIdle(): Promise<void> | null {
  if (!globalThis.__minionHubPgPool && !globalThis.__minionHubPgRlsPool) return null;
  if (!idleHold) {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    idleHold = { promise, resolve };
  }
  const hold = idleHold;
  clearTimeout(hold.timer);
  hold.timer = setTimeout(
    () => {
      idleHold = null;
      hold.resolve();
    },
    (IDLE_TIMEOUT_S + 2) * 1000,
  );
  return hold.promise;
}
