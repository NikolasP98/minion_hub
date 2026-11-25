import { incomeTotal } from './shift-income';

/** Same threshold as `ShiftBanner` (16 h): an older open shift is probably a forgotten one. */
export const SHIFT_STALE_MS = 16 * 60 * 60 * 1000;

export interface ShiftEntry {
  open: boolean;
  /** Open for longer than `SHIFT_STALE_MS`. */
  stale: boolean;
  /** Something the cashier should look at: no open shift, or a stale one. */
  attention: boolean;
  /** Sum of the shift's income across methods (0 when closed). */
  income: number;
}

interface OpenShiftLike {
  shift: { openedAt: string | Date };
  summary: { byMethod: Record<string, number> };
}

/** What the phone calendar's "…" menu shows about the register, from `page.data.openShift`. */
export function shiftEntry(
  openShift: OpenShiftLike | null | undefined,
  now: number,
  /** "Caja automática" (spec 148): no shift yet is normal, the first sale opens it. */
  auto = false,
): ShiftEntry {
  if (!openShift) return { open: false, stale: false, attention: !auto, income: 0 };
  const stale = now - new Date(openShift.shift.openedAt).getTime() > SHIFT_STALE_MS;
  return {
    open: true,
    stale,
    attention: stale,
    income: incomeTotal(openShift.summary.byMethod),
  };
}
