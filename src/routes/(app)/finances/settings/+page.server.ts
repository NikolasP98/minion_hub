import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import { getSource, sourceHasCredentials, getFinSettings } from '$server/services/finance.service';
import { listPeriodLocks, profileNames } from '$server/services/pos.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await datasetCtx(locals, 'finance');
  if (isDenied(ctx)) return { finance: ctx }; // rendered by DataSource (spec 039)
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
    finance: {
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
    },
  };
};
