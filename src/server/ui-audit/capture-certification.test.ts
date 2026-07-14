import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  exactZoomViewport,
  requiresSingleVisibleTitle,
} from '../../../tests/e2e/ui-audit/certification';
import { resolveFixtureProvision } from '../../../tests/e2e/ui-audit/fixtures';
import {
  capturePersona,
  personaCredentials,
  resolvePersonaId,
  selectedPersonaIds,
} from '../../../tests/e2e/ui-audit/personas';
import {
  summarizeResults,
  writeRunArtifact,
  type CaptureRunArtifact,
  type CaptureRunResult,
} from '../../../tests/e2e/ui-audit/run-artifact';
import {
  resolveBuiltInScenarioPreparation,
  validateScenarioEndpoint,
} from '../../../tests/e2e/ui-audit/scenario-hooks';
import type { ResolvedCaptureRoute } from '$lib/routes/capture-route-resolver';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function entry(overrides: Partial<ResolvedCaptureRoute> = {}): ResolvedCaptureRoute {
  return {
    routeId: 'screen:/login',
    pattern: '/login',
    url: '/login',
    persona: 'anonymous',
    viewport: 'compact',
    state: 'default',
    fixtureId: 'base-tenant',
    scenarioKey: 'audit:screen:/login:anonymous:compact:default',
    ...overrides,
  };
}

describe('UI-audit persona and state certification contracts', () => {
  it('maps legacy persona inputs while exposing the manifest-native anonymous path', () => {
    expect(resolvePersonaId('owner')).toBe('owner-admin');
    expect(resolvePersonaId('anonymous')).toBe('anonymous');
    expect(selectedPersonaIds({ E2E_UI_AUDIT_PERSONAS: 'anonymous,restricted' })).toEqual([
      'anonymous',
      'restricted-no-module',
    ]);
    expect(personaCredentials(capturePersona('anonymous'), {})).toBeNull();
    expect(() => resolvePersonaId('production-admin')).toThrow(/Unknown UI-audit persona/);
  });

  it('only treats reproducible built-in states as prepared', () => {
    expect(resolveBuiltInScenarioPreparation(entry())).toEqual({
      status: 'prepared',
      method: 'natural-public',
    });
    expect(
      resolveBuiltInScenarioPreparation(
        entry({ persona: 'restricted-no-module', state: 'forbidden' }),
      ),
    ).toEqual({ status: 'prepared', method: 'persona-access-policy' });
    expect(resolveBuiltInScenarioPreparation(entry({ state: 'loading' }))).toEqual(
      expect.objectContaining({ status: 'blocked', reason: expect.stringContaining('loading') }),
    );
  });

  it('refuses shared or production scenario providers', () => {
    expect(validateScenarioEndpoint('http://127.0.0.1:54321/ui-audit')).toContain('127.0.0.1');
    expect(() => validateScenarioEndpoint('https://hub.minion-ai.org/api/ui-audit')).toThrow(
      /Refusing UI-audit scenario provider/,
    );
  });

  it('resolves provisioned dynamic IDs by the code-owned fixture ID', () => {
    expect(
      resolveFixtureProvision('brain-detail', [
        {
          id: 'brain-route',
          fixtureId: 'brain-detail',
          pattern: '/brains/[id]',
          params: { id: 'disposable-brain' },
        },
      ]),
    ).toEqual({ params: { id: 'disposable-brain' }, query: undefined });
  });
});

describe('UI-audit certification evidence', () => {
  it('uses exact effective CSS dimensions for 200 percent zoom and standard-page titles', () => {
    expect(exactZoomViewport({ width: 1280, height: 800 })).toEqual({ width: 640, height: 400 });
    expect(exactZoomViewport({ width: 390, height: 844 })).toEqual({ width: 195, height: 422 });
    expect(() => exactZoomViewport({ width: 390, height: 844 }, 0)).toThrow(
      /Invalid zoom percentage/,
    );
    expect(requiresSingleVisibleTitle('collection')).toBe(true);
    expect(requiresSingleVisibleTitle('canvas-kanban')).toBe(false);
  });

  it('writes an atomic schema-v3 artifact with blocker totals', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'minion-ui-audit-'));
    temporaryDirectories.push(directory);
    const results: CaptureRunResult[] = [
      {
        scenarioKey: 'one',
        routeId: 'screen:/login',
        pattern: '/login',
        persona: 'anonymous',
        viewportClass: 'compact',
        state: 'default',
        outcome: 'captured',
      },
      {
        scenarioKey: 'two',
        routeId: 'screen:/login',
        pattern: '/login',
        persona: 'anonymous',
        viewportClass: 'compact',
        state: 'loading',
        outcome: 'blocked-state',
      },
    ];
    const artifact: CaptureRunArtifact = {
      schemaVersion: 3,
      runId: 'contract-test',
      startedAt: '2026-07-14T00:00:00.000Z',
      completedAt: '2026-07-14T00:00:01.000Z',
      appCommit: 'deadbeef',
      fixtureVersion: 'ui-audit-v1',
      namespace: 'contract-test',
      exactViewport: { id: 'compact-390', width: 390, height: 844, class: 'compact' },
      theme: 'dark',
      project: 'chromium',
      pointer: 'fine',
      certificationEnabled: true,
      routeFilter: ['/login'],
      results,
      summary: summarizeResults(2, results),
    };
    const output = writeRunArtifact(directory, artifact);
    expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual(
      expect.objectContaining({
        schemaVersion: 3,
        summary: { planned: 2, captured: 1, blocked: 1, failed: 0 },
      }),
    );
  });
});
