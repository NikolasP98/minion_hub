import './pulse-dispatch.worker';
import { runSelectedTick } from './bg-runtime';
import {
  readPulseWorkerConfig,
  readPulseWorkerScope,
  assertPulseConfigCurrent,
} from './pulse-worker-config';
import { cancelPulseForOwnerTx, redactExpiredPulsePayloadsTx } from './pulse-dispatch.store';
import { getCoreDb, getOrgTransactionDb } from '$server/db/pg-client';
import { resolvePulseAuthorityTx } from './pulse-dispatch.authority';
export async function runPulseTick() {
  const deadline = performance.now() + 50_000;
  const config = readPulseWorkerConfig();
  if (!config) {
    const disabledScope = readPulseWorkerScope();
    if (disabledScope)
      await getOrgTransactionDb(getCoreDb()).transaction((tx) =>
        cancelPulseForOwnerTx(
          tx,
          { tenantId: disabledScope.tenantId, profileId: disabledScope.ownerProfileId },
          'worker_disabled',
        ),
      );
    return { advanced: 0, skipped: 'disabled' as const };
  }
  const db = getCoreDb();
  const scope = { tenantId: config.tenantId, profileId: config.ownerProfileId };
  try {
    await getOrgTransactionDb(db).transaction((tx) => resolvePulseAuthorityTx(tx, scope, config));
    assertPulseConfigCurrent(config);
  } catch {
    await getOrgTransactionDb(db).transaction((tx) => cancelPulseForOwnerTx(tx, scope));
    return { advanced: 0, skipped: 'authority_unavailable' as const };
  }
  await getOrgTransactionDb(db).transaction((tx) => redactExpiredPulsePayloadsTx(tx, scope));
  const remaining = deadline - performance.now();
  if (remaining <= 0) return { advanced: 0 };
  return runSelectedTick({
    tenantId: config.tenantId,
    ownerProfileId: config.ownerProfileId,
    types: ['pulse_dispatch'],
    budgetMs: remaining,
    maxCandidates: 20,
  });
}
