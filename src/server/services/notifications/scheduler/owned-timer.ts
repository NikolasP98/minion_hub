/** Waiting is cancellable; the database/provider operation that follows it is not raced. */
export function waitForNotificationTimer(
  milliseconds: number,
  signal: AbortSignal,
): Promise<boolean> {
  if (!Number.isFinite(milliseconds) || milliseconds < 1 || milliseconds > 330000)
    throw new Error('Invalid notification timer');
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const finish = (elapsed: boolean) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      resolve(elapsed);
    };
    const cancel = () => finish(false);
    const timer = setTimeout(() => finish(true), milliseconds);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
}

export function notificationBackoff(attempt: number, random = Math.random): number {
  const base = [5000, 30000, 120000, 300000][Math.min(3, Math.max(0, attempt))];
  return Math.floor(base * (1 + Math.max(0, Math.min(1, random())) * 0.1));
}
