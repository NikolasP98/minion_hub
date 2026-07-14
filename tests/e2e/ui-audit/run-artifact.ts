import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { TestInfo } from '@playwright/test';
import type {
  CapturePersonaId,
  CaptureState,
  CaptureViewport,
} from '../../../src/lib/routes/route-design-manifest';
import type { RuntimeUiDiagnostics } from './runtime-diagnostics';
import type { ScenarioPreparation } from './scenario-hooks';

export type CaptureOutcome =
  | 'captured'
  | 'blocked-auth'
  | 'blocked-fixture'
  | 'blocked-state'
  | 'auth-or-onboarding-redirect'
  | 'failed';

export interface CertificationEvidence {
  zoom200?: RuntimeUiDiagnostics;
  coarsePointer?: {
    requested: boolean;
    matched: boolean;
    diagnostics?: RuntimeUiDiagnostics;
  };
  keyboard?: {
    expected: string[];
    reached: string[];
    missed: string[];
    focusEscaped: boolean;
  };
  longContent?: {
    mutatedTextNodes: number;
    diagnostics: RuntimeUiDiagnostics;
  };
  reducedMotion?: {
    mediaQueryMatches: boolean;
    activeMotion: string[];
  };
}

export interface CaptureRunResult {
  scenarioKey: string;
  routeId: string;
  pattern: string;
  resolvedUrl?: string;
  finalUrl?: string;
  status?: number | null;
  persona: CapturePersonaId;
  viewportClass: CaptureViewport;
  state: CaptureState;
  outcome: CaptureOutcome;
  preparation?: ScenarioPreparation;
  blockReason?: string;
  screenshot?: string;
  consoleErrors?: string[];
  pageErrors?: string[];
  networkFailures?: string[];
  failedSameOriginGets?: string[];
  diagnostics?: RuntimeUiDiagnostics;
  certification?: CertificationEvidence;
  failures?: string[];
}

export interface CaptureRunArtifact {
  schemaVersion: 3;
  runId: string;
  startedAt: string;
  completedAt?: string;
  appCommit: string;
  fixtureVersion: string;
  namespace: string;
  exactViewport: { id: string; width: number; height: number; class: CaptureViewport };
  theme: string;
  project: string;
  pointer: 'fine' | 'coarse';
  certificationEnabled: boolean;
  routeFilter: string[];
  results: CaptureRunResult[];
  summary: {
    planned: number;
    captured: number;
    blocked: number;
    failed: number;
  };
}

export function summarizeResults(
  planned: number,
  results: readonly CaptureRunResult[],
): CaptureRunArtifact['summary'] {
  return {
    planned,
    captured: results.filter((result) => result.outcome === 'captured').length,
    blocked: results.filter((result) => result.outcome.startsWith('blocked-')).length,
    failed: results.filter(
      (result) => result.outcome === 'failed' || result.outcome === 'auth-or-onboarding-redirect',
    ).length,
  };
}

export function writeRunArtifact(outputDir: string, artifact: CaptureRunArtifact): string {
  mkdirSync(outputDir, { recursive: true });
  const target = path.join(outputDir, `run-${artifact.runId}.json`);
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(artifact, null, 2)}\n`);
  renameSync(temporary, target);
  return target;
}

export async function attachRunArtifact(testInfo: TestInfo, artifactPath: string): Promise<void> {
  await testInfo.attach('ui-audit-run-manifest', {
    path: artifactPath,
    contentType: 'application/json',
  });
}
