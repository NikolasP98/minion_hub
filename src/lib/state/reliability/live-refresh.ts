/** Coalesce one query generation. Initial, manual and live reads share one active batch. */
export function createReliabilityLiveRefresh(options: {
  current: () => boolean;
  refresh: () => Promise<unknown>;
  intervalMs?: number;
}) {
  const intervalMs = options.intervalMs ?? 2000;
  let stopped = false;
  let active: Promise<void> | null = null;
  let trailing = false;
  let manualTrailing = false;
  let lastStart = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const current = () => !stopped && options.current();

  function run(task = options.refresh): Promise<void> {
    if (!current()) return Promise.resolve();
    if (active) {
      trailing = true;
      manualTrailing = true;
      return active;
    }
    clearTimeout(timer);
    timer = undefined;
    trailing = false;
    manualTrailing = false;
    lastStart = Date.now();
    active = Promise.resolve()
      .then(() => (current() ? task() : undefined))
      .then(
        () => {},
        () => {},
      )
      .finally(() => {
        active = null;
        if (current()) schedule();
      });
    return active;
  }
  function schedule() {
    if (!current() || timer || active || !trailing) return;
    timer = setTimeout(
      () => {
        timer = undefined;
        void run();
      },
      manualTrailing ? 0 : Math.max(0, intervalMs - (Date.now() - lastStart)),
    );
  }
  return {
    run,
    notify() {
      if (current()) {
        trailing = true;
        schedule();
      }
    },
    dispose() {
      stopped = true;
      trailing = false;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
