/**
 * F7 audit DTOs (minion-meta spec 128). Plain types only: no DB/network/app-alias imports.
 * Foundation slice: only the pure QualifiedOperatorTarget exists so operator-principal can re-export it.
 * TODO(handoff): AuditScope/EvidenceManifest/LinkIntent/AuditSubject/AuditSummary/AuditRun (T004 remainder).
 */

/** Credential-free binding of an approved operator target (database identity + auth project/url). */
export type QualifiedOperatorTarget = Readonly<{
  databaseIdentity: string;
  authProject: string;
  authUrl: string;
}>;
