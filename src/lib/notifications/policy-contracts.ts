/** Semantic policy IDs, not permissions that may be split and passed to RBAC. The projection
 * slice must implement these recipient/row checks before it enables any catalog adapter. */
export const NOTIFICATION_POLICY_CONTRACTS = Object.freeze({
  'booking.read': {
    currentCapability: 'scheduling:view',
    rowScope: 'exact-participant-or-authorized-assignee',
  },
  'stock.read': {
    currentCapability: 'stock:view',
    rowScope: 'configured-recipient-and-item-field-policy',
  },
  'users.manage': { currentCapability: 'users:manage', rowScope: 'exact-target-organization' },
  'subject.or_users_manage': {
    currentCapability: 'users:manage',
    rowScope: 'exact-applicant-or-subject-user-OR-authorized-target-org-manager',
  },
  'finance.read': {
    currentCapability: 'finance:view',
    rowScope: 'configured-recipient-and-currency-snapshot-field-policy',
  },
  'release.active_member': {
    currentCapability: null,
    rowScope: 'exact-active-recipient-and-organization-membership',
  },
  'gateway.operator': {
    currentCapability: 'settings:manage',
    rowScope: 'eligible-operator-for-exact-gateway-binding',
  },
  'automation.owner_or_operator': {
    currentCapability: null,
    rowScope: 'exact-automation-owner-OR-current-authorized-operator',
  },
  'effects.all_sources': {
    currentCapability: null,
    rowScope: 'configured-recipient-authorized-for-every-committed-effect',
  },
  'notice.authorized': {
    currentCapability: null,
    rowScope: 'exact-recipient-and-current-subject-source-authority',
    producerCapability: 'comms:create',
  },
  'report.all_sources': {
    currentCapability: null,
    rowScope: 'exact-reviewed-recipient-and-current-authority-for-every-source-field-row-and-brain',
    producerCapability: 'comms:create',
  },
} as const);
for (const policy of Object.values(NOTIFICATION_POLICY_CONTRACTS)) Object.freeze(policy);
export type NotificationCapabilityPolicy = keyof typeof NOTIFICATION_POLICY_CONTRACTS;
