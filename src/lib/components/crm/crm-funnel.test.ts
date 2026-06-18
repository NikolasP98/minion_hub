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
    expect(maxFunnelStage('loyal', 'intent')).toBe('loyal');
    expect(maxFunnelStage(null, 'intent')).toBe('intent');
    expect(maxFunnelStage('lead', null)).toBe('lead');
    expect(maxFunnelStage(null, null)).toBeNull();
  });
});

describe('financeFloorStage', () => {
  it('maps billing classification to a funnel floor', () => {
    expect(financeFloorStage({ purchased: true, reservedOnly: false, loyal: true })).toBe('loyal');
    expect(financeFloorStage({ purchased: true, reservedOnly: false, loyal: false })).toBe('customer');
    expect(financeFloorStage({ purchased: false, reservedOnly: true, loyal: false })).toBe('intent');
    expect(financeFloorStage({ purchased: false, reservedOnly: false, loyal: false })).toBeNull();
    expect(financeFloorStage(null)).toBeNull();
  });
});

describe('crm-funnel helpers', () => {
  it('orders stages lead → loyal', () => {
    expect(FUNNEL_ORDER).toEqual([
      'lead',
      'interest',
      'consideration',
      'intent',
      'customer',
      'loyal',
    ]);
    expect(funnelStageIndex('lead')).toBe(0);
    expect(funnelStageIndex('loyal')).toBe(5);
    expect(funnelStageIndex('nope')).toBe(-1);
  });

  it('validates stage ids', () => {
    expect(isFunnelStage('interest')).toBe(true);
    expect(isFunnelStage('LOYAL')).toBe(false);
    expect(isFunnelStage(null)).toBe(false);
    expect(isFunnelStage(2)).toBe(false);
  });

  it('reads a valid stored funnel blob and rejects junk', () => {
    expect(readFunnelMeta({ _funnel: { stage: 'interest', auto: false } })?.stage).toBe('interest');
    expect(readFunnelMeta({ _funnel: { stage: 'bogus' } })).toBeNull();
    expect(readFunnelMeta({ _funnel: 'x' })).toBeNull();
    expect(readFunnelMeta(null)).toBeNull();
    // auto defaults to true when omitted.
    expect(readFunnelMeta({ _funnel: { stage: 'lead' } })?.auto).toBe(true);
  });

  it('effective stage = stored stage when present', () => {
    expect(effectiveFunnelStage({ _funnel: { stage: 'intent', auto: true } }, { inbound: 0 })).toBe(
      'intent',
    );
  });

  it('effective stage = baseline lead with inbound, else null', () => {
    expect(effectiveFunnelStage({}, { inbound: 3 })).toBe('lead');
    expect(effectiveFunnelStage(null, { inbound: 1 })).toBe('lead');
    expect(effectiveFunnelStage({}, { inbound: 0 })).toBeNull();
  });
});
