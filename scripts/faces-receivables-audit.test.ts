import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  admitOutputDirectory,
  canonicalJson,
  CliAdmissionError,
  parseArgs,
  readScopeFile,
  resolveCohort,
  RunOutput,
} from './faces-receivables-audit';

const tmp = () => mkdtempSync(join(tmpdir(), 'faces-audit-'));
const ORG = '11111111-1111-4111-8111-111111111111';
const scopeJson = (over: Record<string, unknown> = {}) => ({
  orgId: ORG,
  actorProfileId: '22222222-2222-4222-8222-222222222222',
  accountingTimezone: 'America/Lima',
  approved: { after: '2026-05-01', before: '2026-06-01' },
  outputDirectory: '/x',
  target: { databaseIdentity: 'd', authProject: 'p', authUrl: 'https://a.example.org' },
  ...over,
});
const refused = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(CliAdmissionError);
    expect((error as CliAdmissionError).code).toBe(code);
    return;
  }
  throw new Error('expected refusal');
};

describe('parseArgs', () => {
  it('accepts the closed flag set', () => {
    expect(parseArgs(['--scope', 's.json', '--out', 'o', '--after', '2026-05-02'])).toMatchObject({
      scopePath: 's.json',
      cohort: { after: '2026-05-02', before: null },
    });
  });
  it.each([
    [['--scope', 's', '--out', 'o', '--apply', 'x']],
    [['--scope', 's', '--out']],
    [['--scope', 's', '--scope', 't', '--out', 'o']],
    [['--out', 'o']],
  ])('refuses %j', (argv) => refused(() => parseArgs(argv), 'invalid_arguments'));
  it('refuses impossible dates', () =>
    refused(
      () => parseArgs(['--scope', 's', '--out', 'o', '--after', '2026-02-30']),
      'invalid_date',
    ));
});

describe('scope file and cohort', () => {
  it('reads a valid regular file and refuses a symlink, bad uuid and inverted interval', () => {
    const dir = tmp();
    const file = join(dir, 'scope.json');
    writeFileSync(file, JSON.stringify(scopeJson()));
    expect(readScopeFile(file).orgId).toBe(ORG);
    const link = join(dir, 'link.json');
    symlinkSync(file, link);
    refused(() => readScopeFile(link), 'scope_not_regular_file');
    writeFileSync(file, JSON.stringify(scopeJson({ orgId: 'nope' })));
    refused(() => readScopeFile(file), 'scope_invalid');
    writeFileSync(
      file,
      JSON.stringify(scopeJson({ approved: { after: '2026-06-01', before: '2026-05-01' } })),
    );
    refused(() => readScopeFile(file), 'scope_invalid_interval');
  });
  it('inherits approved bounds and refuses widening', () => {
    const approved = { after: '2026-05-01', before: '2026-06-01' };
    expect(resolveCohort(approved, { after: null, before: null })).toEqual(approved);
    expect(resolveCohort(approved, { after: '2026-05-10', before: '2026-05-11' })).toEqual({
      after: '2026-05-10',
      before: '2026-05-11',
    });
    refused(
      () => resolveCohort(approved, { after: '2026-04-30', before: null }),
      'cohort_outside_approved_scope',
    );
  });
});

describe('output directory and publication', () => {
  it('admits only the approved existing directory', () => {
    const a = tmp();
    const b = tmp();
    expect(admitOutputDirectory(a, a)).toBeTruthy();
    refused(() => admitOutputDirectory(a, b), 'output_directory_not_approved');
    refused(() => admitOutputDirectory(join(a, 'missing'), a), 'output_directory_not_approved');
  });

  it('publishes staging atomically with manifest last, and canonical sorted keys', async () => {
    const dir = tmp();
    const run = new RunOutput(dir, 'run1');
    expect(readdirSync(dir)).toEqual(['run1.staging']);
    await run.writeSubject({ b: 1, a: 2 } as never);
    await run.publish({ z: 1, a: { y: 1, x: 2 } });
    expect(readdirSync(dir)).toEqual(['run1']);
    expect(readdirSync(join(dir, 'run1')).sort()).toEqual([
      'manifest.json',
      'residuals.jsonl',
      'subjects.jsonl',
      'summary.json',
    ]);
    expect(readFileSync(join(dir, 'run1', 'subjects.jsonl'), 'utf8')).toBe('{"a":2,"b":1}\n');
    const manifest = JSON.parse(readFileSync(join(dir, 'run1', 'manifest.json'), 'utf8'));
    expect(manifest.subjects.rows).toBe(1);
    expect(manifest.proposals.count).toBe(0);
    expect(readFileSync(join(dir, 'run1', 'repair-proposals.json'), 'utf8')).toBe('[]\n');
    expect(canonicalJson({ b: [2, { d: 1, c: 2 }], a: null })).toBe(
      '{"a":null,"b":[2,{"c":2,"d":1}]}',
    );
  });

  it('a failed run leaves labelled incomplete staging and no manifest', async () => {
    const dir = tmp();
    const run = new RunOutput(dir, 'run2');
    await run.writeResidual({ id: 'x' } as never);
    await run.fail('incomplete');
    expect(readdirSync(dir)).toEqual(['run2.staging']);
    expect(readdirSync(join(dir, 'run2.staging')).sort()).toEqual([
      'incomplete.json',
      'residuals.jsonl',
      'subjects.jsonl',
    ]);
  });

  it('refuses to reuse a run id', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'run3'));
    refused(() => new RunOutput(dir, 'run3'), 'run_already_exists');
  });
});
