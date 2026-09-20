import { describe, expect, it } from 'vitest';
import { DEFAULT_POS_WORKFLOW, normalizePosWorkflow, posWorkflowSchema } from './workflow';

describe('organization POS workflow policy', () => {
  it('preserves both flows for existing settings', () => {
    expect(normalizePosWorkflow(undefined)).toEqual(DEFAULT_POS_WORKFLOW);
    expect(normalizePosWorkflow({})).toEqual(DEFAULT_POS_WORKFLOW);
  });
  it('accepts deferred scheduling and completion-only payment', () => {
    const policy = { postSaleScheduling: 'defer', appointmentPayment: 'after_completion' };
    expect(posWorkflowSchema.parse(policy)).toEqual(policy);
    expect(normalizePosWorkflow(policy)).toEqual(policy);
  });
  it('rejects unsupported write values instead of silently saving them', () => {
    expect(
      posWorkflowSchema.safeParse({ postSaleScheduling: 'never', appointmentPayment: 'any_time' })
        .success,
    ).toBe(false);
  });
});
