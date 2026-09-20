import { z } from 'zod';

/** Organization policy only; identity and duplicate-charge guards are invariant. */
export const posWorkflowSchema = z.object({
  postSaleScheduling: z.enum(['prompt', 'defer']),
  appointmentPayment: z.enum(['any_time', 'after_completion']),
});
export type PosWorkflow = z.infer<typeof posWorkflowSchema>;
export const DEFAULT_POS_WORKFLOW: Readonly<PosWorkflow> = Object.freeze({
  postSaleScheduling: 'prompt',
  appointmentPayment: 'any_time',
});

export function normalizePosWorkflow(raw: unknown): PosWorkflow {
  const parsed = posWorkflowSchema.safeParse(raw);
  return parsed.success ? parsed.data : { ...DEFAULT_POS_WORKFLOW };
}
