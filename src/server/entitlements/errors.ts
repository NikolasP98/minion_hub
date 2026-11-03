/** Thrown by the model-call backstop (spec 043) when the org in the AI usage scope lacks a feature. */
export class EntitlementError extends Error {
  constructor(
    readonly feature: string,
    readonly reason: 'not_in_plan' | 'rule_false' | 'lookup_error' | 'no_org',
  ) {
    super(`entitlement denied: ${feature} (${reason})`);
    this.name = 'EntitlementError';
  }
}
