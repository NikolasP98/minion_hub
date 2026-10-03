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

const EXPECTED = [
  'DS1 prototype attributes',
  'DS2 editor paste and Markdown',
  'DS3 ordinary sanitizer',
  'DS4 detached sanitizer subtree',
] as const;

type ArtifactIdentity = { sha256: string; boundary: unknown };

export default class DependencySecurityArtifact implements Reporter {
  private tests: TestCase[] = [];
  private initialArtifact: ArtifactIdentity | null = null;
  private artifactError: string | null = null;
  private results: {
    title: string;
    project: string;
    status: string;
    duration: number;
    evidence: string[];
  }[] = [];

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
      };
      if (manifest.boundary?.violations !== 0) throw new Error('bundle boundary not proven');
      return {
        sha256: crypto.createHash('sha256').update(body).digest('hex'),
        boundary: manifest.boundary,
      };
    } catch (error) {
      this.artifactError = error instanceof Error ? error.message : 'artifact unavailable';
      return null;
    }
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this.results.push({
      title: test.title,
      project: test.parent.project()?.name ?? '',
      status: result.status,
      duration: result.duration,
      evidence: result.attachments.map((attachment) => attachment.name).sort(),
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
    const passed =
      result.status === 'passed' &&
      exact &&
      this.artifactError === null &&
      this.initialArtifact !== null &&
      this.results.length === EXPECTED.length &&
      this.results.every(
        (entry) =>
          entry.status === 'passed' &&
          entry.evidence.includes('network-boundary') &&
          entry.evidence.includes('runtime-identity'),
      );
    const report = {
      status: passed ? 'passed' : 'failed',
      expected: [...EXPECTED],
      discovered,
      results: this.results,
      artifact: this.initialArtifact,
      artifactError: this.artifactError,
      browserCache: process.env.PLAYWRIGHT_BROWSERS_PATH ?? null,
      node: process.version,
    };
    fs.mkdirSync(path.dirname(this.options.output), { recursive: true });
    fs.writeFileSync(this.options.output, JSON.stringify(report, null, 2), { mode: 0o600 });
    return { status: passed ? 'passed' : 'failed' };
  }
}
