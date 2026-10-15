import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { getSource, sourceHasCredentials, getFinSettings } from '$server/services/finance.service';
import { listPeriodLocks, profileNames } from '$server/services/pos.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('finance:period-locks');
  const [src, sunatSrc, settings, locks] = await Promise.all([
    getSource(ctx, 'susii'),
    getSource(ctx, 'sunat-sire'),
    getFinSettings(ctx),
    listPeriodLocks(ctx),
  ]);
  const lockerNames = await profileNames(
    ctx,
    locks.map((l) => l.lockedBy),
  );
  return {
    periodLocks: locks.map((l) => ({
      ...l,
      lockedByName: l.lockedBy ? (lockerNames[l.lockedBy] ?? null) : null,
    })),
    source: src
      ? { ...src, secretRefs: undefined, hasCredentials: sourceHasCredentials(src) }
      : null,
    sunatSource: sunatSrc
      ? { ...sunatSrc, secretRefs: undefined, hasCredentials: sourceHasCredentials(sunatSrc) }
      : null,
    settings,
  };
};
