import type { CoreCtx } from '$server/auth/core-ctx';
import type { DoorRow } from '$lib/doors/types';
import { configSchema, type FormPublicData } from '$lib/doors/kinds/form';

export const kind = 'form' as const;

/** The form's shape for the anonymous page: fields and consent text only, no submissions. */
export async function publicView(_ctx: CoreCtx, door: DoorRow): Promise<FormPublicData> {
  const cfg = configSchema.parse(door.config);
  return {
    fields: cfg.fields,
    consentText: cfg.consentText,
    consentRequired: cfg.consentRequired,
    successMessage: cfg.successMessage ?? null,
  };
}
