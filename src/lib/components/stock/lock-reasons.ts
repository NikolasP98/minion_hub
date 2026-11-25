import * as m from '$lib/paraglide/messages';
import { formatDate } from '$lib/utils/format';
import type { LockHit } from '$lib/types/record-locks';

const dayMonth = (value: string | Date, timeZone?: string) =>
  formatDate(value, { day: '2-digit', month: '2-digit', ...(timeZone ? { timeZone } : {}) });

/** 'YYYY-MM' -> 'MM/YYYY'. */
const period = (p: string | undefined) => (p ?? '').split('-').reverse().join('/');

/** One translated line per lock hit (notice, refusal and audit list share it). */
export function lockReason(h: LockHit): string {
  const lockedAt = h.lockedAt ? dayMonth(h.lockedAt) : '';
  const label = h.label ?? '';
  switch (h.kind) {
    case 'days':
      return m.record_locks_reason_days({ days: h.days ?? 0 });
    case 'month':
      return m.record_locks_reason_month({ period: period(h.period) });
    case 'month_current':
      return m.record_locks_reason_month_current({ period: period(h.period) });
    case 'webhook_date':
      return m.record_locks_reason_webhook_date({
        label,
        upTo: h.upTo ? dayMonth(`${h.upTo}T00:00:00Z`, 'UTC') : '',
        lockedAt,
      });
    case 'webhook_record':
      return m.record_locks_reason_webhook_record({ label, lockedAt });
    default:
      return m.record_locks_reason_chain();
  }
}
