import type { CoreCtx } from '$server/auth/core-ctx';
import type { DoorRow } from '$lib/doors/types';
import { configSchema, type FaqPublicData } from '$lib/doors/kinds/faq';

export const kind = 'faq' as const;

/** Public projection: approved entries only (drafts never leave the hub). */
export async function publicView(_ctx: CoreCtx, door: DoorRow): Promise<FaqPublicData> {
  const parsed = configSchema.safeParse(door.config);
  if (!parsed.success) return { entries: [], whatsappNumber: null };
  return {
    entries: parsed.data.entries
      .filter((e) => e.status === 'approved' && e.a.length > 0)
      .map((e) => ({ q: e.q, a: e.a })),
    whatsappNumber: parsed.data.whatsappNumber ?? null,
  };
}
