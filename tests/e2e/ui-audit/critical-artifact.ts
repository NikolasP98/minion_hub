import type {
  Reporter,
  FullConfig,
  Suite,
  TestCase,
  TestResult,
  FullResult,
} from '@playwright/test/reporter';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export default class CriticalArtifact implements Reporter {
  private tests: TestCase[] = [];
  private artifactSha256: string | null = null;
  private artifactError: string | null = null;
  private results: {
    title: string;
    project: string;
    status: string;
    duration: number;
    evidence: Record<string, unknown>;
  }[] = [];
  constructor(private options: { output: string }) {}
  onBegin(_config: FullConfig, suite: Suite) {
    this.tests = suite.allTests();
    this.artifactSha256 = this.readArtifactHash();
  }
  private readArtifactHash(): string | null {
    try {
      if (!process.env.MINION_CRITICAL_OUT) throw new Error('Missing artifact root');
      return crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(process.env.MINION_CRITICAL_OUT, 'manifest.json')))
        .digest('hex');
    } catch {
      this.artifactError = 'Artifact manifest unavailable';
      return null;
    }
  }
  onTestEnd(test: TestCase, result: TestResult) {
    const evidence: Record<string, unknown> = {};
    for (const item of result.attachments) {
      if (!['runtime-identity', 'network-boundary', 'native-focus-states'].includes(item.name))
        continue;
      const body = item.body ?? (item.path ? fs.readFileSync(item.path) : undefined);
      if (body) evidence[item.name] = JSON.parse(body.toString('utf8'));
    }
    this.results.push({
      title: test.title,
      project: test.parent.project()?.name ?? '',
      status: result.status,
      duration: result.duration,
      evidence,
    });
  }
  async onEnd(result: FullResult): Promise<{ status: FullResult['status'] }> {
    const expected = ['CJ1 ', 'CJ2 ', 'CJ3 ', 'CJ4 ', 'CJ5 ', 'CJ6 '];
    const requiredProjects = [
      'chromium-fine',
      'chromium-coarse',
      'firefox-fine',
      'webkit-fine',
      'webkit-coarse',
    ];
    const projects = [...new Set(this.tests.map((t) => t.parent.project()?.name))];
    const complete =
      this.tests.length === requiredProjects.length * expected.length &&
      projects.length === requiredProjects.length &&
      requiredProjects.every((project) =>
        expected.every(
          (prefix) =>
            this.tests.filter(
              (t) => t.parent.project()?.name === project && t.title.startsWith(prefix),
            ).length === 1,
        ),
      );
    const finalArtifactSha256 = this.readArtifactHash();
    if (this.artifactSha256 && this.artifactSha256 !== finalArtifactSha256)
      this.artifactError = 'Artifact manifest changed during the run';
    const passed =
      complete &&
      this.artifactSha256 !== null &&
      this.artifactError === null &&
      this.results.length === this.tests.length &&
      this.results.every(
        (r) =>
          r.status === 'passed' &&
          Object.hasOwn(r.evidence, 'runtime-identity') &&
          Object.hasOwn(r.evidence, 'network-boundary'),
      ) &&
      result.status === 'passed';
    const report = {
      status: passed ? 'passed-fixture-only' : 'failed',
      authenticatedIntegration: false,
      runner: {
        node: process.version,
        cacheDir: process.env.PWTEST_CACHE_DIR,
        tmpDir: process.env.TMPDIR,
        browserCache: process.env.PLAYWRIGHT_BROWSERS_PATH,
        webkitExecutable: process.env.MINION_WEBKIT_EXECUTABLE ?? null,
      },
      projects,
      requiredProjects,
      expectedTests: requiredProjects.length * expected.length,
      actualTests: this.tests.length,
      results: this.results,
      artifactSha256: this.artifactSha256,
      artifactError: this.artifactError,
    };
    fs.mkdirSync(path.dirname(this.options.output), { recursive: true });
    fs.writeFileSync(this.options.output, JSON.stringify(report, null, 2));
    return { status: passed ? 'passed' : 'failed' };
  }
}
