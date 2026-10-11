import { appointmentOverdueRule } from './appointment-overdue';
import { visitUnpaidRule } from './visit-unpaid';
import { shiftOpenAfterHoursRule } from './shift-open-after-hours';
import { stockLowRule } from './stock-low';
import { servicePaidUnscheduledRule } from './service-paid-unscheduled';
import { packageExpiringRule } from './package-expiring';
import { planOverdueRule } from './plan-overdue';
import { financeSyncFailedRule } from './finance-sync-failed';
import { crmDniPendingRule } from './crm-dni-pending';
import { crmBirthdayRule } from './crm-birthday';
import type { Rule } from './types';

export type { Rule, RuleResult } from './types';

// TODO(handoff): `channel.whatsapp_logged_out` (spec Slice 4) is SKIPPED — no
// DB-backed per-org read of real WhatsApp login/logout state exists. The hub
// `channels` table's `status` column (`channel.service.ts`'s `listChannels`)
// only ever reflects the config `enabled` flag, written by
// `channel-sync.service.ts`'s `writeChannelRows` — never a real gateway
// session state. The only live signal is `crm-channels.service.ts`'s
// `getChannelCatalog`, a best-effort RPC (`gatewayCall('channels.status', …)`)
// that a `withOrgCore` DB-transaction rule on a 10-minute tick can't rely on
// the way the other rules rely on a table. Build this once the gateway (or a
// sync job) persists channel session state into a queryable column — do not
// invent one here. See proposals/2026-10-10-hub-inbox-notifications-reminders.md.
export const INBOX_RULES: Rule[] = [
  appointmentOverdueRule,
  visitUnpaidRule,
  shiftOpenAfterHoursRule,
  stockLowRule,
  servicePaidUnscheduledRule,
  packageExpiringRule,
  planOverdueRule,
  financeSyncFailedRule,
  crmDniPendingRule,
  crmBirthdayRule,
];
