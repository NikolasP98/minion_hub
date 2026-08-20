#!/usr/bin/env bun
/**
 * Slice 1's merge gate, asked out loud.
 *
 * `scripts/rekey-readiness-gate.test.ts` is deliberately conditional: it only
 * reds when `updateServer` already carries its tenant predicate. That is right
 * for a test suite — there is nothing to stop while the predicate is parked —
 * but it means a green `bun run test` says nothing about whether Slice 1's human
 * half is finished. This command asks the unconditional question instead:
 *
 *   bun run rekey:readiness
 *
 * It exits 1 and names every missing artifact until a credential holder has
 * recorded a passing audit for both environments (`bun run audit:server-tenant-scope
 * -- --record <environment>`) and filled in the concrete re-key record. It exits
 * 0 only when all four artifacts the spec requires are present and passing.
 *
 * It reads a file; it holds no credentials and touches no database.
 *
 * Pointer: docs/runbooks/server-tenant-scope-rekey-readiness.md.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  EVIDENCE_RELATIVE_PATH,
  formatReadinessReport,
  parseRekeyCliArgs,
  rekeyReadinessReport,
} from './audit-server-tenant-scope.lib';

function main(): void {
  const { evidencePath } = parseRekeyCliArgs(process.argv.slice(2), { allowRecord: false });
  const resolved = evidencePath ?? path.resolve(import.meta.dirname, '..', EVIDENCE_RELATIVE_PATH);

  // An absent file is the parked state, not an error: report BLOCKED with the
  // full list of what is owed rather than a stack trace.
  const evidence = existsSync(resolved) ? JSON.parse(readFileSync(resolved, 'utf8')) : undefined;
  const report = rekeyReadinessReport(evidence);

  console.log(formatReadinessReport(report));
  console.log(`[readiness] evidence file: ${resolved}${existsSync(resolved) ? '' : ' (absent)'}`);
  if (report.status === 'READY') {
    console.log('[readiness] Slice 1 evidence is complete — the tenant predicate may proceed');
    return;
  }
  for (const missing of report.missing) console.error(`[readiness] missing: ${missing}`);
  console.error('[readiness] BLOCKED — see docs/runbooks/server-tenant-scope-rekey-readiness.md');
  process.exit(1);
}

try {
  main();
} catch (err) {
  console.error('[readiness] failed:', err);
  process.exit(1);
}
