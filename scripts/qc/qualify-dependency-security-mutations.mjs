#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  DEPENDENCY_SECURITY_MUTATIONS,
  assertExpectedDependencyMutationFailure,
} from './dependency-security-mutation-contract.mjs';

const root = process.cwd();
const requestedRoot = process.env.MINION_DEPENDENCY_MUTATION_RUN_ROOT;
let runRoot;
if (requestedRoot) {
  runRoot = path.resolve(requestedRoot);
  if (!path.isAbsolute(requestedRoot) || fs.existsSync(runRoot)) {
    throw new Error('MINION_DEPENDENCY_MUTATION_RUN_ROOT must be a fresh absolute path');
  }
  fs.mkdirSync(runRoot, { recursive: false, mode: 0o700 });
} else {
  runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'minion-dependency-mutations-'));
  fs.chmodSync(runRoot, 0o700);
}

const receipt = {
  status: 'failed',
  error: null,
  runRoot,
  mutations: [],
};

/** @param {string} file */
function readBoundedJson(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 1024 * 1024) {
    throw new Error(`Invalid dependency mutation receipt: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** @param {string} mutation @param {string} childRoot */
function runMutation(mutation, childRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/qc/run-dependency-security.mjs'], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        CI: '1',
        PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
        MINION_DEPENDENCY_RUN_ROOT: childRoot,
        MINION_DEPENDENCY_MUTATION: mutation,
        MINION_DEPENDENCY_MUTATION_CANARY: '1',
      },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

try {
  const mutations = /** @type {Array<keyof typeof DEPENDENCY_SECURITY_MUTATIONS>} */ (
    Object.keys(DEPENDENCY_SECURITY_MUTATIONS)
  );
  for (const mutation of mutations) {
    const childRoot = path.join(runRoot, mutation);
    const processResult = await runMutation(mutation, childRoot);
    const runner = readBoundedJson(path.join(childRoot, 'runner-receipt.json'));
    const report = readBoundedJson(path.join(childRoot, 'evidence', 'dependency-results.json'));
    const summary = assertExpectedDependencyMutationFailure({
      mutation,
      processResult,
      runner,
      report,
    });
    receipt.mutations.push({ childRoot, processResult, summary });
  }
  receipt.status = 'passed';
} catch (error) {
  receipt.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  fs.writeFileSync(
    path.join(runRoot, 'mutation-qualification-receipt.json'),
    JSON.stringify(receipt, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify({ dependencyMutationRunRoot: runRoot }));
}
