import { describe, it, expect } from 'vitest';
import {
  FUNNEL_ORDER,
  funnelStageIndex,
  isFunnelStage,
  readFunnelMeta,
  effectiveFunnelStage,
  maxFunnelStage,
  financeFloorStage,
} from './crm-funnel';

describe('maxFunnelStage', () => {
  it('returns the deeper stage, ignoring nulls', () => {
    expect(maxFunnelStage('lead', 'customer')).toBe('customer');
    expect(maxFunnelStage('loyal', 'opportunity')).toBe('loyal');
    expect(maxFunnelStage(null, 'opportunity')).toBe('opportunity');
    expect(maxFunnelStage('lead', null)).toBe('lead');
    expect(maxFunnelStage(null, null)).toBeNull();
  });
});

describe('financeFloorStage', () => {
  it('maps billing classification to a funnel floor', () => {
    expect(financeFloorStage({ purchased: true, reservedOnly: false, loyal: true })).toBe('loyal');
    expect(financeFloorStage({ purchased: true, reservedOnly: false, loyal: false })).toBe('customer');
    expect(financeFloorStage({ purchased: false, reservedOnly: true, loyal: false })).toBe('opportunity');
    expect(financeFloorStage({ purchased: false, reservedOnly: false, loyal: false })).toBeNull();
    expect(financeFloorStage(null)).toBeNull();
  });
});

describe('crm-funnel helpers', () => {
  it('orders stages lead → loyal (4-stage)', () => {
    expect(FUNNEL_ORDER).toEqual(['lead', 'opportunity', 'customer', 'loyal']);
    expect(funnelStageIndex('lead')).toBe(0);
    expect(funnelStageIndex('loyal')).toBe(3);
    expect(funnelStageIndex('nope')).toBe(-1);
  });

  it('validates stage ids', () => {
    expect(isFunnelStage('opportunity')).toBe(true);
    expect(isFunnelStage('interest')).toBe(false); // legacy id is not a current stage
    expect(isFunnelStage('LOYAL')).toBe(false);
    expect(isFunnelStage(null)).toBe(false);
    expect(isFunnelStage(2)).toBe(false);
  });

  it('reads a stored funnel blob, remapping legacy stages and rejecting junk', () => {
    expect(readFunnelMeta({ _funnel: { stage: 'opportunity', auto: false } })?.stage).toBe('opportunity');
    // legacy interest/consideration/intent collapse to opportunity.
    expect(readFunnelMeta({ _funnel: { stage: 'interest' } })?.stage).toBe('opportunity');
    expect(readFunnelMeta({ _funnel: { stage: 'intent' } })?.stage).toBe('opportunity');
    expect(readFunnelMeta({ _funnel: { stage: 'bogus' } })).toBeNull();
    expect(readFunnelMeta({ _funnel: 'x' })).toBeNull();
    expect(readFunnelMeta(null)).toBeNull();
    // auto defaults to true when omitted.
    expect(readFunnelMeta({ _funnel: { stage: 'lead' } })?.auto).toBe(true);
  });

  it('effective stage = stored stage when present (legacy remapped)', () => {
    expect(effectiveFunnelStage({ _funnel: { stage: 'intent', auto: true } }, { inbound: 0 })).toBe(
      'opportunity',
    );
  });

  it('effective stage = baseline lead with inbound, else null', () => {
    expect(effectiveFunnelStage({}, { inbound: 3 })).toBe('lead');
    expect(effectiveFunnelStage(null, { inbound: 1 })).toBe('lead');
    expect(effectiveFunnelStage({}, { inbound: 0 })).toBeNull();
  });
});
