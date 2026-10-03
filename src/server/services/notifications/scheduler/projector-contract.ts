import type { OrganizationLease, OrganizationResult, RuntimeIdentity } from './contracts';

export interface NotificationProjector {
  readonly revision: string;
  readonly sha256: string;
  readonly supportedCatalogRevisions: readonly string[];
  /** Own the complete claim/projection/settlement operation; never return with detached effects. */
  projectPage(lease: OrganizationLease, signal: AbortSignal): Promise<OrganizationResult>;
}
export type NotificationAdmission =
  | Readonly<{ state: 'ready'; identity: RuntimeIdentity; projector: NotificationProjector }>
  | Readonly<{ state: 'failed'; observation: import('./contracts').AdmissionObservation }>;
