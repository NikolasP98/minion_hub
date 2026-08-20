import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REQUIRED_AUDIT_ENVIRONMENTS,
  rekeyReadinessGateFailures,
  updateServerIsTenantScoped,
} from './audit-server-tenant-scope.lib';

/**
 * Executable Slice 1 stop rule for
 * specs/2026-08-18-hub-updateserver-tenant-scope-spec.md, checked over the
 * shipped service's source shape.
 *
 * The spec parks the `eq(servers.tenantId, ctx.tenantId)` predicate behind a
 * two-environment readiness audit plus the concrete re-key record, and until now
 * that rule lived only in prose — a comment nobody's build enforces. This binds
 * the two together in both directions: a tenant-scoped mutation reds the suite
 * unless `tests/rekey-readiness/evidence.json` records both passing audits and
 * the re-key deployment, and complete evidence reds it while the mutation is
 * still keyed on `servers.id` alone. Today the predicate is absent, the evidence
 * file is absent, and the gate is green — that is the parked state, asserted
 * rather than assumed.
 *
 * This file is the cheap half. The gate's primary input is the *observed*
 * behaviour of `updateServer` — `src/server/services/server.service.test.ts`
 * ("updateServer tenant scope") runs it against a two-tenant table and derives
 * the same boolean from which rows actually moved, then pins the source-shape
 * answer here against it. A source scan alone can be talked into a false yes by
 * a comment or a nearby read; running the function cannot.
 */
const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const SERVICE_PATH = path.join(REPO_ROOT, 'src/server/services/server.service.ts');
const EVIDENCE_PATH = path.join(REPO_ROOT, 'tests/rekey-readiness/evidence.json');
const RUNBOOK_PATH = path.join(REPO_ROOT, 'docs/runbooks/server-tenant-scope-rekey-readiness.md');

function readEvidence(): unknown {
  if (!existsSync(EVIDENCE_PATH)) return undefined;
  return JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8'));
}

describe('re-key readiness gate', () => {
  it('lets the shipped updateServer predicate exist only with recorded readiness evidence', () => {
    const predicateIsTenantScoped = updateServerIsTenantScoped(readFileSync(SERVICE_PATH, 'utf8'));

    expect(
      rekeyReadinessGateFailures({ predicateIsTenantScoped, evidence: readEvidence() }),
    ).toEqual([]);
  });

  it('documents the gate in the runbook the failure message points at', () => {
    const runbook = readFileSync(RUNBOOK_PATH, 'utf8');
    expect(runbook).toContain('tests/rekey-readiness/evidence.json');
    for (const environment of REQUIRED_AUDIT_ENVIRONMENTS) {
      expect(runbook).toContain(environment);
    }
  });
});
