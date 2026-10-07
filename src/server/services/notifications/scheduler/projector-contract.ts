import type { NotificationProjectionSupport } from '$lib/notifications/projection-manifest';
import type {
  OrganizationLease,
  OrganizationResult,
  RuntimeIdentity,
  RuntimeLease,
} from './contracts';

export interface NotificationProjector {
  readonly revision: string;
  readonly sha256: string;
  readonly supportedProjectionTuples: readonly NotificationProjectionSupport[];
  /** Own the complete claim/projection/settlement operation; never return with detached effects. */
  projectPage(
    runtime: RuntimeLease,
    lease: OrganizationLease,
    signal: AbortSignal,
  ): Promise<OrganizationResult>;
}
export type NotificationAdmission =
  | Readonly<{ state: 'ready'; identity: RuntimeIdentity; projector: NotificationProjector }>
  | Readonly<{ state: 'failed'; observation: import('./contracts').AdmissionObservation }>;
