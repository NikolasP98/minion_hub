import './pulse-dispatch.worker';
import './pulse-digest.worker';
import { readDigestPolicy, readDigestScope } from './pulse-digest.policy';
import { collectDueDigest } from './pulse-digest.collection';
import { assertDigestAuthorityTx } from './pulse-digest.authority';
import { cancelDigestForOwnerTx, redactDigestTx } from './pulse-digest.store';
import { redactPulseFeedbackTx } from './pulse-feedback.service';
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
  const digest = readDigestPolicy();
  const digestScope = readDigestScope();
  const rawDigest = readDigestPolicy(true);
  if (!digestScope && (process.env.MINION_PULSE_DIGEST_SCOPE !== undefined || rawDigest?.enabled))
    return { advanced: 0, skipped: 'digest_scope_unavailable' as const };
  if (
    rawDigest &&
    digestScope &&
    (rawDigest.tenantId !== digestScope.tenantId ||
      rawDigest.ownerProfileId !== digestScope.ownerProfileId)
  )
    return { advanced: 0, skipped: 'digest_scope_mismatch' as const };
  // Cleanup uses only the validated retained deployment target, without spend/view admission.
  // Run each family once: dispatch20 + runs50/sources10 + feedback20 <=100 raw records.
  if (digestScope) {
    const retained = { tenantId: digestScope.tenantId, profileId: digestScope.ownerProfileId };
    for (const redact of [redactExpiredPulsePayloadsTx, redactDigestTx, redactPulseFeedbackTx]) {
      if (performance.now() >= deadline) return { advanced: 0 };
      await getOrgTransactionDb(getCoreDb()).transaction((tx) => redact(tx, retained));
    }
    if (performance.now() >= deadline) return { advanced: 0 };
    if (!digest)
      await getOrgTransactionDb(getCoreDb()).transaction((tx) =>
        cancelDigestForOwnerTx(tx, retained, 'digest_disabled'),
      );
  }
  if (
    config &&
    digest &&
    (config.tenantId !== digest.tenantId || config.ownerProfileId !== digest.ownerProfileId)
  )
    throw new Error('Pulse policy scope mismatch');
  if (!config && !digest) {
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
  const selected = config ?? digest!;
  const scope = { tenantId: selected.tenantId, profileId: selected.ownerProfileId };
  try {
    if (config) {
      await getOrgTransactionDb(db).transaction((tx) => resolvePulseAuthorityTx(tx, scope, config));
      assertPulseConfigCurrent(config);
    }
    if (digest)
      await getOrgTransactionDb(db).transaction((tx) => assertDigestAuthorityTx(tx, digest));
  } catch {
    await getOrgTransactionDb(db).transaction((tx) => cancelPulseForOwnerTx(tx, scope));
    return { advanced: 0, skipped: 'authority_unavailable' as const };
  }
  if (!digestScope)
    await getOrgTransactionDb(db).transaction((tx) => redactExpiredPulsePayloadsTx(tx, scope));
  if (digest && deadline - performance.now() > 2000) {
    await collectDueDigest(digest, deadline);
  }
  const remaining = deadline - performance.now();
  if (remaining <= 0) return { advanced: 0 };
  return runSelectedTick({
    tenantId: selected.tenantId,
    ownerProfileId: selected.ownerProfileId,
    types: [...(config ? ['pulse_dispatch'] : []), ...(digest ? ['pulse_digest'] : [])],
    budgetMs: remaining,
    maxCandidates: 20,
  });
}
