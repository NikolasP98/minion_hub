import { createHash, randomUUID } from 'node:crypto';
import { NOTIFICATION_CATALOG_REVISION } from '$lib/notifications/catalog';
import { notificationCatalogManifest } from '$lib/notifications/catalog-manifest';
import catalogReceipt from '$lib/notifications/catalog.revision.json';
import catalogBytes from '$lib/notifications/catalog.manifest.json?raw';
import type { NotificationAdmission, NotificationProjector } from './projector-contract';
import type { AdmissionFailure } from './contracts';
import { admitNotificationProjectionCatalog } from '../projection/catalog-admission';

declare const __MINION_NOTIFICATION_QUALIFICATION__: boolean;
declare const __MINION_NOTIFICATION_BUILD_SHA__: string;
declare const __MINION_NOTIFICATION_QUALIFICATION_SHA__: string;

export async function admitNotificationWorker(signal: AbortSignal): Promise<NotificationAdmission> {
  const ownerId = randomUUID();
  const buildSha =
    typeof __MINION_NOTIFICATION_BUILD_SHA__ === 'string' &&
    /^[a-f0-9]{40}$/.test(__MINION_NOTIFICATION_BUILD_SHA__)
      ? __MINION_NOTIFICATION_BUILD_SHA__
      : null;
  let catalogSha256: string | null = null;
  let catalogRevision: string | null = null;
  let projectorRevision: string | null = null;
  let projectorSha256: string | null = null;
  // Qualification identifies its exact source artifact here. The compiled bundle
  // has a separate external manifest receipt; this is not a production bundle hash.
  const artifactSha256 =
    typeof __MINION_NOTIFICATION_QUALIFICATION_SHA__ === 'string' &&
    /^[a-f0-9]{64}$/.test(__MINION_NOTIFICATION_QUALIFICATION_SHA__)
      ? __MINION_NOTIFICATION_QUALIFICATION_SHA__
      : null;
  const fail = (code: AdmissionFailure): NotificationAdmission =>
    Object.freeze({
      state: 'failed',
      observation: Object.freeze({
        ownerId,
        code,
        buildSha,
        artifactSha256,
        catalogRevision,
        catalogSha256,
        projectorRevision,
        projectorSha256,
      }),
    });
  try {
    catalogRevision = NOTIFICATION_CATALOG_REVISION;
    const current = notificationCatalogManifest();
    catalogSha256 = createHash('sha256').update(current).digest('hex');
    if (
      current !== catalogBytes ||
      catalogReceipt.revision !== NOTIFICATION_CATALOG_REVISION ||
      catalogReceipt.sha256 !== catalogSha256
    )
      return fail('catalog_invalid');
  } catch {
    return fail('catalog_invalid');
  }
  if (!buildSha) return fail('build_unavailable');
  let projector: NotificationProjector | null = null;
  if (
    typeof __MINION_NOTIFICATION_QUALIFICATION__ !== 'undefined' &&
    __MINION_NOTIFICATION_QUALIFICATION__
  ) {
    try {
      const qualification = await import('./qualification-projector');
      projectorRevision = 'qualification-only.1';
      projectorSha256 = artifactSha256;
      if (signal.aborted) return fail('startup_failed');
      projector = await qualification.admitQualificationProjector(signal);
    } catch {
      return fail('startup_failed');
    }
  } else {
    try {
      const production = await import('../projection/projector');
      if (signal.aborted) return fail('startup_failed');
      projector = production.productionNotificationProjector();
      projectorRevision = projector.revision;
      projectorSha256 = projector.sha256;
      if (!(await admitNotificationProjectionCatalog(signal)))
        return fail('projection_unavailable');
    } catch {
      return fail('projection_unavailable');
    }
  }
  if (projector === null) return fail('projection_unavailable');
  if (
    projector.supportedProjectionTuples.length === 0 ||
    projector.supportedProjectionTuples.some(
      (entry) => entry.catalogRevision !== NOTIFICATION_CATALOG_REVISION,
    )
  )
    return fail('catalog_mismatch');
  return Object.freeze({
    state: 'ready',
    identity: Object.freeze({
      ownerId,
      buildSha,
      catalogRevision: NOTIFICATION_CATALOG_REVISION,
      catalogSha256,
      projectorRevision: projector.revision,
      projectorSha256: projector.sha256,
    }),
    projector,
  });
}
