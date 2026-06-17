import * as m from '$lib/paraglide/messages';

/**
 * Localize a lifecycle stage value (the English token stored/derived in SQL)
 * for display. Kept out of crm-format.ts so that module stays paraglide-free
 * and unit-testable without resolving SvelteKit aliases.
 */
export function stageLabel(stage: string): string {
  switch (stage) {
    case 'New':
      return m.crm_stage_new();
    case 'Engaged':
      return m.crm_stage_engaged();
    case 'Active':
      return m.crm_stage_active();
    case 'Dormant':
      return m.crm_stage_dormant();
    case 'Churned':
      return m.crm_stage_churned();
    default:
      return stage;
  }
}

/** Localize a marketing-funnel stage id (see crm-funnel.ts FUNNEL_ORDER). */
export function funnelStageLabel(stage: string): string {
  switch (stage) {
    case 'lead':
      return m.crm_funnel_lead();
    case 'interest':
      return m.crm_funnel_interest();
    case 'consideration':
      return m.crm_funnel_consideration();
    case 'intent':
      return m.crm_funnel_intent();
    case 'customer':
      return m.crm_funnel_customer();
    case 'loyal':
      return m.crm_funnel_loyal();
    default:
      return stage;
  }
}
