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
