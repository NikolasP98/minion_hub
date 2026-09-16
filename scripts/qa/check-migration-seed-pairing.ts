#!/usr/bin/env bun
/**
 * Enforces spec §6 rule 1 ("A schema change ships with its seed"):
 *
 *   Any PR touching supabase/migrations/*.sql must also touch
 *   scripts/qa/seed/** or supabase/qa/baseline/** — or carry the
 *   `seed-unaffected` label with a one-line reason in the PR body.
 *
 * Pure logic lives in `evaluatePairing()` (tested for all four quadrants);
 * this file's `main()` is just wiring: figure out the changed files and PR
 * labels, then apply the rule.
 *
 * Usage:
 *   bun scripts/qa/check-migration-seed-pairing.ts
 *     — CI mode. Changed files come from `git diff --name-only <base>...HEAD`
 *       (base = --base, else github.event.pull_request.base.sha from
 *       $GITHUB_EVENT_PATH, else `origin/$GITHUB_BASE_REF`). Labels come from
 *       --labels, else $GITHUB_EVENT_PATH's pull_request.labels[].name.
 *   bun scripts/qa/check-migration-seed-pairing.ts --files a.sql b.ts --labels seed-unaffected
 *     — explicit mode, for local testing/reproduction.
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface PairingInput {
  changed: readonly string[];
  labels: readonly string[];
}

export interface PairingResult {
  ok: boolean;
  migrationFiles: readonly string[];
  reason?: string;
}

const MIGRATION_RE = /^supabase\/migrations\/.*\.sql$/;
const SEED_UNAFFECTED_LABEL = 'seed-unaffected';

/** Pure: spec §6 rule 1, all four (migrations touched x seed/label present) quadrants. */
export function evaluatePairing({ changed, labels }: PairingInput): PairingResult {
  const migrationFiles = changed.filter((f) => MIGRATION_RE.test(f));
  if (migrationFiles.length === 0) {
    return { ok: true, migrationFiles: [] };
  }

  const seedTouched = changed.some(
    (f) => f.startsWith('scripts/qa/seed/') || f.startsWith('supabase/qa/baseline/'),
  );
  if (seedTouched) {
    return { ok: true, migrationFiles };
  }

  if (labels.includes(SEED_UNAFFECTED_LABEL)) {
    return { ok: true, migrationFiles };
  }

  return {
    ok: false,
    migrationFiles,
    reason:
      'spec §6 rule 1 — "A schema change ships with its seed. Any PR touching ' +
      'supabase/migrations/*.sql must touch scripts/qa/seed/** or supabase/qa/baseline/** ' +
      '(or carry the seed-unaffected label with a one-line reason in the PR body)."\n' +
      `This PR touches ${migrationFiles.length} migration file(s) but nothing under ` +
      'scripts/qa/seed/** or supabase/qa/baseline/**, and has no seed-unaffected label:\n' +
      migrationFiles.map((f) => `  - ${f}`).join('\n'),
  };
}

function argList(argv: string[], flag: string): string[] | undefined {
  const i = argv.indexOf(flag);
  if (i === -1) return undefined;
  return argv.slice(i + 1).filter((a) => !a.startsWith('--'));
}

function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
}

interface PrEvent {
  baseSha?: string;
  labels: string[];
}

function readPrEvent(): PrEvent {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !existsSync(eventPath)) return { labels: [] };
  const event = JSON.parse(readFileSync(eventPath, 'utf8')) as {
    pull_request?: { base?: { sha?: string }; labels?: { name: string }[] };
  };
  const pr = event.pull_request;
  return {
    baseSha: pr?.base?.sha,
    labels: (pr?.labels ?? []).map((l) => l.name),
  };
}

function changedFilesFromGit(base: string): string[] {
  const result = spawnSync('git', ['diff', '--name-only', `${base}...HEAD`], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`git diff --name-only ${base}...HEAD failed:\n${result.stderr}`);
  }
  return result.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function main(): void {
  const argv = process.argv.slice(2);
  const explicitFiles = argList(argv, '--files');
  const labelsArg = argValue(argv, '--labels');

  let changed: string[];
  let labels: string[];

  if (explicitFiles) {
    changed = explicitFiles;
    labels = labelsArg ? labelsArg.split(',').filter(Boolean) : [];
  } else {
    const prEvent = readPrEvent();
    labels = labelsArg ? labelsArg.split(',').filter(Boolean) : prEvent.labels;
    const base =
      argValue(argv, '--base') ??
      prEvent.baseSha ??
      (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : undefined);
    if (!base) {
      throw new Error(
        'no base to diff against — pass --base <sha-or-ref>, or run in a pull_request CI ' +
          'context where $GITHUB_EVENT_PATH or $GITHUB_BASE_REF is set',
      );
    }
    changed = changedFilesFromGit(base);
  }

  const result = evaluatePairing({ changed, labels });
  if (!result.ok) {
    console.error(`check-migration-seed-pairing FAILED\n\n${result.reason}`);
    process.exit(1);
  }
  console.log(
    result.migrationFiles.length === 0
      ? 'check-migration-seed-pairing OK — no supabase/migrations/*.sql changes in this diff.'
      : `check-migration-seed-pairing OK — ${result.migrationFiles.length} migration file(s) ` +
          'changed, paired with a seed/baseline change or the seed-unaffected label.',
  );
}

if (import.meta.main) main();
