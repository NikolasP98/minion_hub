import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import { assertDependencyCaseEvidence } from '../../scripts/qc/dependency-security-mutation-contract.mjs';

const EXPECTED = [
  'DS1 prototype attributes',
  'DS2 editor paste and Markdown',
  'DS3 ordinary sanitizer',
  'DS4 detached sanitizer subtree',
] as const;

type ArtifactIdentity = { sha256: string; boundary: unknown; mutation: string };
type ResultEntry = {
  title: string;
  project: string;
  status: string;
  duration: number;
  evidence: string[];
  checkResult: unknown;
  networkBoundary: unknown;
  runtimeIdentity: unknown;
  errors: string[];
  evidenceError: string | null;
};

function readJsonAttachment(result: TestResult, name: string): unknown {
  const matches = result.attachments.filter((attachment) => attachment.name === name);
  if (matches.length !== 1) throw new Error(`${name} attachment count was not one`);
  const [attachment] = matches;
  if (attachment.contentType !== 'application/json') {
    throw new Error(`${name} attachment was not JSON`);
  }
  let body: Buffer;
  if (attachment.body) {
    body = attachment.body;
  } else if (attachment.path) {
    const stat = fs.lstatSync(attachment.path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024) {
      throw new Error(`${name} attachment path was invalid`);
    }
    body = fs.readFileSync(attachment.path);
  } else {
    throw new Error(`${name} attachment had no body`);
  }
  if (body.byteLength < 2 || body.byteLength > 8 * 1024) {
    throw new Error(`${name} attachment size was invalid`);
  }
  return JSON.parse(body.toString('utf8'));
}

export default class DependencySecurityArtifact implements Reporter {
  private tests: TestCase[] = [];
  private initialArtifact: ArtifactIdentity | null = null;
  private artifactError: string | null = null;
  private results: ResultEntry[] = [];

  constructor(private options: { output: string }) {}

  onBegin(_config: FullConfig, suite: Suite) {
    this.tests = suite.allTests();
    this.initialArtifact = this.readArtifact();
  }

  private readArtifact(): ArtifactIdentity | null {
    try {
      if (!process.env.MINION_DEPENDENCY_OUT) throw new Error('missing artifact root');
      const body = fs.readFileSync(path.join(process.env.MINION_DEPENDENCY_OUT, 'manifest.json'));
      const manifest = JSON.parse(body.toString('utf8')) as {
        boundary?: { violations?: number };
        mutation?: string;
      };
      if (manifest.boundary?.violations !== 0) throw new Error('bundle boundary not proven');
      const expectedMutation = process.env.MINION_DEPENDENCY_MUTATION ?? 'none';
      if (manifest.mutation !== expectedMutation) {
        throw new Error('artifact mutation identity does not match the runner');
      }
      return {
        sha256: crypto.createHash('sha256').update(body).digest('hex'),
        boundary: manifest.boundary,
        mutation: manifest.mutation,
      };
    } catch (error) {
      this.artifactError = error instanceof Error ? error.message : 'artifact unavailable';
      return null;
    }
  }

  onTestEnd(test: TestCase, result: TestResult) {
    let checkResult: unknown = null;
    let networkBoundary: unknown = null;
    let runtimeIdentity: unknown = null;
    let evidenceError: string | null = null;
    try {
      checkResult = readJsonAttachment(result, 'check-result');
      networkBoundary = readJsonAttachment(result, 'network-boundary');
      runtimeIdentity = readJsonAttachment(result, 'runtime-identity');
    } catch (error) {
      evidenceError = error instanceof Error ? error.message : 'invalid structured evidence';
    }
    this.results.push({
      title: test.title,
      project: test.parent.project()?.name ?? '',
      status: result.status,
      duration: result.duration,
      evidence: result.attachments.map((attachment) => attachment.name).sort(),
      checkResult,
      networkBoundary,
      runtimeIdentity,
      errors: result.errors.map((error) => (error.message ?? 'unknown test error').slice(0, 512)),
      evidenceError,
    });
  }

  async onEnd(result: FullResult): Promise<{ status: FullResult['status'] }> {
    const finalArtifact = this.readArtifact();
    if (this.initialArtifact?.sha256 !== finalArtifact?.sha256) {
      this.artifactError = 'artifact manifest changed during the run';
    }
    const discovered = this.tests.map((test) => ({
      title: test.title,
      project: test.parent.project()?.name ?? '',
    }));
    const exact =
      discovered.length === EXPECTED.length &&
      EXPECTED.every(
        (title) =>
          discovered.filter((test) => test.title === title && test.project === 'chromium')
            .length === 1,
      );
    const structuredEvidencePassed = this.results.every((entry) => {
      try {
        assertDependencyCaseEvidence({ entry, mutation: 'none', expectedInvariant: null });
        return true;
      } catch {
        return false;
      }
    });
    const passed =
      result.status === 'passed' &&
      exact &&
      this.artifactError === null &&
      this.initialArtifact !== null &&
      this.results.length === EXPECTED.length &&
      structuredEvidencePassed;
    const report = {
      status: passed ? 'passed' : 'failed',
      expected: [...EXPECTED],
      discovered,
      results: this.results,
      artifact: this.initialArtifact,
      artifactError: this.artifactError,
      mutation: process.env.MINION_DEPENDENCY_MUTATION ?? 'none',
      browserCache: process.env.PLAYWRIGHT_BROWSERS_PATH ?? null,
      node: process.version,
    };
    fs.mkdirSync(path.dirname(this.options.output), { recursive: true });
    fs.writeFileSync(this.options.output, JSON.stringify(report, null, 2), { mode: 0o600 });
    return { status: passed ? 'passed' : 'failed' };
  }
}
