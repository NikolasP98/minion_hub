import { PosError } from './errors';
import { decimalToNumber, type DecimalInput } from '$lib/money/decimal';
import { moneyNumber, storedMoneyMinor, storedMinorNumber, withMoneyError } from './money';

/** JSON money maps are validated before the UI or a reconciliation sum sees them. */
export function moneyRecord(raw: unknown, source: 'input' | 'stored'): Record<string, number> {
  const code = source === 'stored' ? 'invalid_stored_amount' : 'invalid_amount';
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    throw new PosError('Invalid money amounts.', code);
  const entries = Object.entries(raw);
  if (entries.length > 10000) throw new PosError('Too many money amounts.', code);
  return Object.fromEntries(
    entries.map(([key, amount]) => {
      if (
        source === 'input' &&
        withMoneyError(code, () => decimalToNumber(amount as DecimalInput)) < 0
      ) {
        throw new PosError('Drawer amounts must be nonnegative.', code);
      }
      const value =
        source === 'stored' ? storedMinorNumber(storedMoneyMinor(amount)) : moneyNumber(amount);
      if (value < 0) throw new PosError('Drawer amounts must be nonnegative.', code);
      return [key, value];
    }),
  );
}

/** Payment amount already excludes change; opening cash is added exactly once. */
export function computeExpected(
  byMethod: Record<string, number>,
  openingFloat: Record<string, number>,
  methods: readonly { id: string; takesTendered: boolean }[],
): Record<string, number> {
  const expected = new Map(Object.entries(moneyRecord(byMethod, 'stored')));
  const opening = moneyRecord(openingFloat, 'stored');
  for (const method of methods) {
    if (!method.takesTendered) continue;
    const prior = expected.get(method.id) ?? 0;
    const initial = Object.hasOwn(opening, method.id) ? opening[method.id] : 0;
    expected.set(method.id, storedMinorNumber(storedMoneyMinor(prior) + storedMoneyMinor(initial)));
  }
  return Object.fromEntries(expected);
}

export function checkedShift<
  T extends { openingFloat: unknown; counted: unknown; expected: unknown },
>(shift: T): T {
  return {
    ...shift,
    openingFloat: moneyRecord(shift.openingFloat, 'stored'),
    counted: shift.counted == null ? shift.counted : moneyRecord(shift.counted, 'stored'),
    expected: shift.expected == null ? shift.expected : moneyRecord(shift.expected, 'stored'),
  };
}
