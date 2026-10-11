#!/usr/bin/env node
/**
 * Release-notes generator for `.github/workflows/release-notes.yml`
 * (spec 2026-10-10-hub-inbox-notifications-reminders, Slice 3).
 *
 * Pure parsing/grouping lives here so it has a unit test independent of git
 * and network; `main()` (git log, gh, CHANGELOG.md, tag, POST) only runs when
 * this file is executed directly, not when it's imported by the test.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const CONVENTIONAL_TYPE_LABELS = {
  feat: 'Nuevo',
  fix: 'Arreglado',
  refactor: 'Interno',
  chore: 'Interno',
  docs: 'Interno',
};
const DEFAULT_LABEL = 'Interno';
// `type(scope): sentence` or `type: sentence`, optionally `type!:` (breaking).
const CONVENTIONAL_RE = /^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/;
// Squash-merge subjects end with " (#123)" — strip it, the number comes from
// the PR list separately (title text alone can't be trusted to carry it).
const TRAILING_PR_NUMBER_RE = /\s*\(#\d+\)\s*$/;

/** One PR title -> { label, scope, sentence }. Unrecognized/non-conventional
 *  titles fall back to `Interno` with no scope, whole title as the sentence. */
export function parseConventionalTitle(rawTitle) {
  const cleaned = rawTitle.replace(TRAILING_PR_NUMBER_RE, '').trim();
  const match = cleaned.match(CONVENTIONAL_RE);
  if (!match) return { label: DEFAULT_LABEL, scope: '', sentence: cleaned };
  const [, type, scope, sentence] = match;
  const label = CONVENTIONAL_TYPE_LABELS[type.toLowerCase()] ?? DEFAULT_LABEL;
  return { label, scope: scope ?? '', sentence: sentence.trim() };
}

/**
 * Group merged PRs into `{ [label]: { [scope]: string[] } }`, the exact
 * shape `app_releases.sections` stores and `/changelog` renders.
 * `prs`: Array<{ number: number, title: string, url: string }>.
 */
export function groupPrs(prs) {
  const sections = {};
  for (const pr of prs) {
    const { label, scope, sentence } = parseConventionalTitle(pr.title);
    sections[label] ??= {};
    sections[label][scope] ??= [];
    sections[label][scope].push(sentence);
  }
  return sections;
}

/** Render a dated CHANGELOG.md section (also the dry-run stdout). */
export function renderChangelogSection(version, releasedAtIso, sections) {
  const lines = [`## ${version} — ${releasedAtIso.slice(0, 10)}`, ''];
  for (const [label, byScope] of Object.entries(sections)) {
    const entries = Object.entries(byScope);
    if (entries.length === 0) continue;
    lines.push(`### ${label}`, '');
    for (const [scope, sentences] of entries) {
      for (const sentence of sentences) {
        lines.push(scope ? `- **${scope}**: ${sentence}` : `- ${sentence}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
}

/** Last `hub-v*` tag by creation order, or null if none exists yet. */
function lastReleaseTag() {
  const out = sh('git', ['tag', '--list', 'hub-v*', '--sort=-creatordate']);
  return out.split('\n').filter(Boolean)[0] ?? null;
}

/** Fallback range start when no tag exists yet: the first commit of today (UTC). */
function firstCommitOfToday() {
  const today = new Date().toISOString().slice(0, 10);
  const out = sh('git', ['log', '--since', `${today}T00:00:00Z`, '--format=%H', '--reverse']);
  const first = out.split('\n').filter(Boolean)[0];
  return first ?? 'HEAD';
}

/** Merged PRs in (base, HEAD] via squash-merge subjects (each carries " (#NNN)").
 *  Squash merges are plain commits (no second parent), so `--merges` can't
 *  find them — read every subject in the range and keep the ones with a
 *  trailing PR number instead. */
function mergedPrsSince(base) {
  const subjects = sh('git', ['log', `${base}..HEAD`, '--format=%s']).split('\n').filter(Boolean);
  const prs = [];
  for (const subject of subjects) {
    const match = subject.match(/\(#(\d+)\)\s*$/);
    if (!match) continue;
    const number = Number(match[1]);
    prs.push({
      number,
      title: subject,
      url: `https://github.com/${process.env.GITHUB_REPOSITORY ?? 'NikolasP98/minion_hub'}/pull/${number}`,
    });
  }
  return prs;
}

function nextVersion() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
  const base = `hub-v${date}`;
  const existing = sh('git', ['tag', '--list', `${base}*`]).split('\n').filter(Boolean);
  if (existing.length === 0) return base;
  let n = 1;
  while (existing.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run') || process.env.RELEASE_NOTES_DRY_RUN === '1';
  const base = lastReleaseTag() ?? firstCommitOfToday();
  const prs = mergedPrsSince(base);
  const sections = groupPrs(prs);
  const version = nextVersion();
  const releasedAt = new Date().toISOString();
  const section = renderChangelogSection(version, releasedAt, sections);

  console.log(`# Release-notes dry-run (base=${base}, prs=${prs.length})\n`);
  console.log(section);

  if (dryRun) return;

  const changelogPath = 'CHANGELOG.md';
  const prior = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : '';
  writeFileSync(changelogPath, `${section}\n${prior}`);
  sh('git', ['add', 'CHANGELOG.md']);
  sh('git', ['commit', '-m', `docs(changelog): ${version} [skip ci]`]);
  sh('git', ['tag', version]);

  const secret = process.env.CRON_SECRET;
  const url = process.env.RELEASES_ENDPOINT ?? 'https://hub.minion-ai.org/api/releases';
  if (!secret) throw new Error('CRON_SECRET is required to POST the release');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify({ version, releasedAt, sections, prs }),
  });
  if (!res.ok) throw new Error(`POST ${url} failed: ${res.status} ${await res.text()}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
