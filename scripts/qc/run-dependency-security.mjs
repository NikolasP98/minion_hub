#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const root = process.cwd();
const requestedRoot = process.env.MINION_DEPENDENCY_RUN_ROOT;
let runRoot;
if (requestedRoot) {
  runRoot = path.resolve(requestedRoot);
  if (!path.isAbsolute(requestedRoot) || fs.existsSync(runRoot)) {
    throw new Error('MINION_DEPENDENCY_RUN_ROOT must be a fresh absolute path');
  }
  fs.mkdirSync(runRoot, { recursive: false, mode: 0o700 });
} else {
  runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'minion-dependency-security-'));
  fs.chmodSync(runRoot, 0o700);
}

const output = path.join(runRoot, 'build');
const evidence = path.join(runRoot, 'evidence');
const home = path.join(runRoot, 'home');
const temp = path.join(runRoot, 'tmp');
const cache = path.join(runRoot, 'playwright-cache');
for (const directory of [evidence, home, temp, cache]) fs.mkdirSync(directory, { mode: 0o700 });

const browserCache = process.env.PLAYWRIGHT_BROWSERS_PATH;
const mutation = process.env.MINION_DEPENDENCY_MUTATION ?? 'none';
const allowedMutations = new Set(['none', 'editor-paste', 'ordinary-sanitizer']);
if (!allowedMutations.has(mutation)) throw new Error('Unknown dependency security mutation');
if (mutation !== 'none' && process.env.MINION_DEPENDENCY_MUTATION_CANARY !== '1') {
  throw new Error('Dependency security mutations require the mutation qualification runner');
}
const runId = randomUUID();
const baseEnvironment = {
  PATH: process.env.PATH,
  CI: '1',
  HOME: home,
  TMPDIR: temp,
  PWTEST_CACHE_DIR: cache,
  PLAYWRIGHT_BROWSERS_PATH: browserCache,
  MINION_DEPENDENCY_MUTATION: mutation,
  ...(mutation === 'none' ? {} : { MINION_DEPENDENCY_MUTATION_CANARY: '1' }),
};
const receipt = {
  status: 'failed',
  error: null,
  runRoot,
  output,
  evidence,
  browserCache: browserCache ?? null,
  mutation,
  runId,
  build: null,
  browser: null,
  shutdown: null,
};
let server;
let serverError;
let serverClosed = false;

function run(command, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: environment, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (serverError) throw serverError;
    if (server && server.exitCode !== null) throw new Error('Dependency fixture server exited');
    try {
      const response = await fetch('http://127.0.0.1:18904/index.html', {
        method: 'HEAD',
        signal: AbortSignal.timeout(500),
      });
      if (response.ok && response.headers.get('x-minion-fixture-run') === runId) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Dependency fixture server did not become ready');
}

function waitForChildClose(child, timeoutMs) {
  if (serverClosed) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('close', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function stopServer() {
  if (!server || serverClosed) {
    return { stopped: true, forced: false };
  }
  server.kill('SIGTERM');
  if (await waitForChildClose(server, 5_000)) return { stopped: true, forced: false };
  server.kill('SIGKILL');
  if (await waitForChildClose(server, 2_000)) {
    throw new Error('Dependency fixture server required forced termination');
  }
  throw new Error('Dependency fixture server did not stop');
}

try {
  if (
    !browserCache ||
    !path.isAbsolute(browserCache) ||
    !fs.existsSync(browserCache) ||
    fs.realpathSync(browserCache) !== path.resolve(browserCache)
  ) {
    throw new Error('PLAYWRIGHT_BROWSERS_PATH must identify an installed absolute browser cache');
  }
  receipt.build = await run(process.execPath, ['tests/fixtures/dependency-security/build.mjs'], {
    ...baseEnvironment,
    MINION_DEPENDENCY_OUT: output,
  });
  if (receipt.build.code !== 0) throw new Error('Dependency fixture build failed');
  server = spawn(process.execPath, ['tests/fixtures/dependency-security/serve.mjs'], {
    cwd: root,
    env: {
      ...baseEnvironment,
      MINION_DEPENDENCY_OUT: output,
      MINION_DEPENDENCY_RUN_ID: runId,
    },
    stdio: 'inherit',
  });
  server.once('error', (error) => {
    serverError = error;
  });
  server.once('close', () => {
    serverClosed = true;
  });
  await waitForServer();
  receipt.browser = await run(
    process.execPath,
    [
      'node_modules/@playwright/test/cli.js',
      'test',
      '--config',
      'playwright.dependency-security.config.ts',
    ],
    {
      ...baseEnvironment,
      MINION_DEPENDENCY_URL: 'http://127.0.0.1:18904',
      MINION_DEPENDENCY_OUT: output,
      MINION_DEPENDENCY_EVIDENCE: evidence,
    },
  );
  if (receipt.browser.code !== 0) throw new Error('Dependency browser qualification failed');
  const report = JSON.parse(
    fs.readFileSync(path.join(evidence, 'dependency-results.json'), 'utf8'),
  );
  if (report.status !== 'passed') throw new Error('Dependency browser receipt is not passing');
  receipt.status = 'passed';
} catch (error) {
  receipt.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  try {
    receipt.shutdown = await stopServer();
  } catch (error) {
    receipt.status = 'failed';
    receipt.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    fs.writeFileSync(path.join(runRoot, 'runner-receipt.json'), JSON.stringify(receipt, null, 2), {
      mode: 0o600,
    });
    console.log(JSON.stringify({ dependencySecurityRunRoot: runRoot }));
  }
}
