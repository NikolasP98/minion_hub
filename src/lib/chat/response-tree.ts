export interface BranchRow {
  key: string;
  role: 'user' | 'assistant';
}

export interface TurnBranch {
  attempts: string[];
  active: number;
}

export function normalizeTurnBranches(value: unknown): Record<string, TurnBranch> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const normalized: Record<string, TurnBranch> = {};
  for (const [rootKey, candidate] of Object.entries(value)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const branch = candidate as { attempts?: unknown; active?: unknown };
    const attempts = Array.isArray(branch.attempts)
      ? [
          ...new Set(
            branch.attempts.filter(
              (key): key is string => typeof key === 'string' && key.length > 0,
            ),
          ),
        ]
      : [];
    if (attempts.length === 0 || !attempts.includes(rootKey)) continue;
    const requestedActive =
      typeof branch.active === 'number' && Number.isInteger(branch.active)
        ? branch.active
        : attempts.length - 1;
    normalized[rootKey] = {
      attempts,
      active: Math.max(0, Math.min(attempts.length - 1, requestedActive)),
    };
  }
  return normalized;
}

function turnEnd<T extends BranchRow>(rows: T[], start: number): number {
  let end = start + 1;
  while (end < rows.length && rows[end].role !== 'user') end++;
  return end;
}

/** Projects appended retry turns into one navigable slot at the original turn. */
export function projectTurnBranches<T extends BranchRow>(
  rows: T[],
  branches: Record<string, TurnBranch>,
): T[] {
  const byKey = new Map(rows.map((row, index) => [row.key, index]));
  const hidden = new Set<number>();
  const replacement = new Map<number, T[]>();
  for (const [rootKey, branch] of Object.entries(branches)) {
    const rootIndex = byKey.get(rootKey);
    if (rootIndex === undefined) continue;
    const activeIndex = byKey.get(branch.attempts[branch.active] ?? rootKey);
    if (activeIndex === undefined) continue;
    const validAttemptIndices = branch.attempts
      .map((attemptKey) => byKey.get(attemptKey))
      .filter((index): index is number => index !== undefined);
    // A stale/incomplete branch must never hide history. Wait until the active
    // attempt exists in the freshly loaded transcript, then project atomically.
    if (validAttemptIndices.length !== branch.attempts.length) continue;
    for (const attemptIndex of validAttemptIndices) {
      if (attemptIndex === rootIndex) continue;
      for (let i = attemptIndex; i < turnEnd(rows, attemptIndex); i++) hidden.add(i);
    }
    if (activeIndex !== rootIndex) {
      for (let i = rootIndex; i < turnEnd(rows, rootIndex); i++) hidden.add(i);
      replacement.set(rootIndex, rows.slice(activeIndex, turnEnd(rows, activeIndex)));
    }
  }
  const result: T[] = [];
  for (let i = 0; i < rows.length; i++) {
    const swapped = replacement.get(i);
    if (swapped) result.push(...swapped);
    else if (!hidden.has(i)) result.push(rows[i]);
  }
  return result;
}
