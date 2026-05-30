/**
 * Reactive idle-banter budget.
 *
 * Agents auto-chat ("banter") when idle and near each other, capped at
 * `settings.idleBanterBudgetPerHour` per rolling hour. The counters used to be
 * module-private `let`s in conversation-manager.ts (a plain .ts file, so no
 * runes). They live here as `$state` so the toolbar meter can read them live —
 * the manager mutates this object; reactivity rides on the object, not the
 * mutating file.
 */

const HOUR_MS = 3_600_000;

export const banterBudget = $state<{ used: number; resetAt: number }>({
  used: 0,
  resetAt: Date.now() + HOUR_MS,
});

/** Reset the hourly counter (also called lazily when the window elapses). */
export function resetBanterBudget(): void {
  banterBudget.used = 0;
  banterBudget.resetAt = Date.now() + HOUR_MS;
}

/** Record one banter toward the hourly budget. */
export function recordBanter(): void {
  banterBudget.used++;
}
