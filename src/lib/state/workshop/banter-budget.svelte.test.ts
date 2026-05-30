/**
 * Unit tests for the reactive idle-banter budget.
 * This module is dependency-free (only runes), so no `$app`/env mocks needed.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { banterBudget, recordBanter, resetBanterBudget } from './banter-budget.svelte';

beforeEach(() => resetBanterBudget());

describe('banter budget', () => {
  it('starts empty with a future reset window', () => {
    expect(banterBudget.used).toBe(0);
    expect(banterBudget.resetAt).toBeGreaterThan(0);
  });

  it('records banters', () => {
    recordBanter();
    recordBanter();
    recordBanter();
    expect(banterBudget.used).toBe(3);
  });

  it('reset zeroes the count and pushes the window forward', () => {
    recordBanter();
    const before = banterBudget.resetAt;
    resetBanterBudget();
    expect(banterBudget.used).toBe(0);
    expect(banterBudget.resetAt).toBeGreaterThanOrEqual(before);
  });
});
