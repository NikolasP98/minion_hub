#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const root = process.cwd();
const requestedRoot = process.env.MINION_CRITICAL_RUN_ROOT;
let runRoot;
if (requestedRoot) {
  runRoot = path.resolve(requestedRoot);
  if (!path.isAbsolute(requestedRoot) || fs.existsSync(runRoot)) {
    throw new Error('MINION_CRITICAL_RUN_ROOT must be a fresh absolute path');
  }
  fs.mkdirSync(runRoot, { recursive: false, mode: 0o700 });
} else {
  runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'minion-critical-journeys-'));
  fs.chmodSync(runRoot, 0o700);
}

const output = path.join(runRoot, 'build');
const evidence = path.join(runRoot, 'evidence');
const home = path.join(runRoot, 'home');
const temp = path.join(runRoot, 'tmp');
const cache = path.join(runRoot, 'playwright-cache');
for (const directory of [evidence, home, temp, cache]) fs.mkdirSync(directory, { mode: 0o700 });

const browserCache = process.env.PLAYWRIGHT_BROWSERS_PATH;
const runId = randomUUID();
const baseEnvironment = {
  PATH: process.env.PATH,
  CI: '1',
  HOME: home,
  TMPDIR: temp,
  PWTEST_CACHE_DIR: cache,
  PLAYWRIGHT_BROWSERS_PATH: browserCache,
  NODE_OPTIONS: '--max-old-space-size=1536',
};
const receipt = {
  status: 'failed',
  error: null,
  runRoot,
  output,
  evidence,
  browserCache: browserCache ?? null,
  runId,
  build: null,
  browser: null,
};
let server;
let serverError;

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
    if (server && server.exitCode !== null) throw new Error('Critical fixture server exited');
    try {
      const response = await fetch('http://127.0.0.1:18903/home.html', {
        method: 'HEAD',
        signal: AbortSignal.timeout(500),
      });
      if (response.ok && response.headers.get('x-minion-fixture-run') === runId) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Critical fixture server did not become ready');
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
  receipt.build = await run(process.execPath, ['tests/fixtures/critical-journeys/build.mjs'], {
    ...baseEnvironment,
    MINION_CRITICAL_OUT: output,
    MINION_CRITICAL_EVIDENCE: evidence,
  });
  if (receipt.build.code !== 0) throw new Error('Critical fixture build failed');
  server = spawn(process.execPath, ['tests/fixtures/critical-journeys/serve.mjs'], {
    cwd: root,
    env: { ...baseEnvironment, MINION_CRITICAL_OUT: output, MINION_CRITICAL_RUN_ID: runId },
    stdio: 'inherit',
  });
  server.once('error', (error) => {
    serverError = error;
  });
  await waitForServer();
  receipt.browser = await run(
    process.execPath,
    ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.critical.config.ts'],
    {
      ...baseEnvironment,
      MINION_CRITICAL_URL: 'http://127.0.0.1:18903',
      MINION_CRITICAL_OUT: output,
      MINION_CRITICAL_EVIDENCE: evidence,
      ...(process.env.MINION_WEBKIT_EXECUTABLE
        ? { MINION_WEBKIT_EXECUTABLE: process.env.MINION_WEBKIT_EXECUTABLE }
        : {}),
    },
  );
  if (receipt.browser.code !== 0) throw new Error('Critical journey qualification failed');
  const report = JSON.parse(fs.readFileSync(path.join(evidence, 'critical-results.json'), 'utf8'));
  if (report.status !== 'passed-fixture-only')
    throw new Error('Critical journey receipt is not passing');
  receipt.status = 'passed';
} catch (error) {
  receipt.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  if (server && server.exitCode === null) server.kill('SIGTERM');
  fs.writeFileSync(path.join(runRoot, 'runner-receipt.json'), JSON.stringify(receipt, null, 2), {
    mode: 0o600,
  });
  console.log(JSON.stringify({ criticalJourneyRunRoot: runRoot }));
}
