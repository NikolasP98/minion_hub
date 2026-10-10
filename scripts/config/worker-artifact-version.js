export function workerArtifactVersion(environment = process.env) {
  if (environment.MINION_WORKER_ARTIFACT_BUILD !== '1') return undefined;
  const sourceSha = environment.NOTIFICATION_BUILD_SHA ?? '';
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) {
    throw new Error('worker artifact build requires an exact notification source SHA');
  }
  return sourceSha;
}
