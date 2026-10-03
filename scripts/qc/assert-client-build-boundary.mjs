#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { svelteKitOutDir } from '../config/sveltekit-outdir.js';
import { assertClientBundleBoundary, relativeClientModule } from './client-bundle-boundary.mjs';
import { CLIENT_MODULE_BOUNDARY_REPORT } from './client-build-boundary-plugin.mjs';

const MAX_OUTPUT_FILES = 5_000;
const MAX_OUTPUT_DIRECTORIES = 1_000;
const MAX_OUTPUT_DEPTH = 32;
const MAX_SCANNED_FILE_BYTES = 16 * 1024 * 1024;
const MAX_SCANNED_BYTES = 64 * 1024 * 1024;

const configuredOutput = path.join(svelteKitOutDir(process.env.VITE_CACHE_DIR), 'output', 'client');
const root = path.resolve(process.argv[2] ?? configuredOutput);
if (!fs.existsSync(root) || fs.realpathSync(root) !== root || !fs.statSync(root).isDirectory()) {
  throw new Error('Client output must be an existing absolute non-symlink directory');
}

function walk(directory, state = { directories: 0, files: [] }, depth = 0) {
  if (depth > MAX_OUTPUT_DEPTH) {
    throw new Error(`Client output exceeds directory depth limit: ${MAX_OUTPUT_DEPTH}`);
  }
  state.directories += 1;
  if (state.directories > MAX_OUTPUT_DIRECTORIES) {
    throw new Error(`Client output exceeds directory count limit: ${MAX_OUTPUT_DIRECTORIES}`);
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink in client output: ${file}`);
    if (entry.isDirectory()) {
      if (!fs.lstatSync(file).isDirectory()) throw new Error(`Invalid client directory: ${file}`);
      walk(file, state, depth + 1);
      continue;
    }
    if (!entry.isFile() || !fs.lstatSync(file).isFile()) {
      throw new Error(`Non-regular client output: ${file}`);
    }
    state.files.push(file);
    if (state.files.length > MAX_OUTPUT_FILES) {
      throw new Error(`Unexpected client artifact count: more than ${MAX_OUTPUT_FILES}`);
    }
  }
  return state;
}

const outputState = walk(root);
const outputFiles = outputState.files;
if (outputFiles.length === 0) {
  throw new Error(`Unexpected client artifact count: ${outputFiles.length}`);
}

let scannedBytes = 0;
function readBounded(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile()) throw new Error(`Non-regular client output: ${file}`);
  if (stat.size > MAX_SCANNED_FILE_BYTES) {
    throw new Error(
      `Client artifact exceeds per-file scan limit: ${relativeClientModule(root, file)}`,
    );
  }
  if (scannedBytes + stat.size > MAX_SCANNED_BYTES) {
    throw new Error('Client artifacts exceed aggregate scan limit');
  }
  scannedBytes += stat.size;
  return fs.readFileSync(file, 'utf8');
}

const manifestFiles = outputFiles.filter((file) => file.endsWith('/.vite/manifest.json'));
if (manifestFiles.length !== 1) throw new Error('Client Vite manifest must exist exactly once');
const manifest = JSON.parse(readBounded(manifestFiles[0]));
const modules = Object.entries(manifest).flatMap(([key, value]) => [
  key,
  typeof value === 'object' && value && 'src' in value ? String(value.src) : '',
]);
const artifacts = outputFiles
  .filter((file) => /\.(?:js|mjs|html)$/i.test(file))
  .map((file) => ({
    path: relativeClientModule(root, file),
    source: readBounded(file),
  }));

const rollupReportFile = path.join(root, CLIENT_MODULE_BOUNDARY_REPORT);
if (!outputFiles.includes(rollupReportFile))
  throw new Error('Client Rollup module report is missing');
const rollupReport = JSON.parse(readBounded(rollupReportFile));
if (
  rollupReport.schemaVersion !== 1 ||
  rollupReport.environment !== 'client' ||
  !Number.isSafeInteger(rollupReport.modules) ||
  rollupReport.modules < 1 ||
  rollupReport.modules > 100_000 ||
  !/^[a-f0-9]{64}$/.test(rollupReport.graphSha256) ||
  rollupReport.violations !== 0
) {
  throw new Error('Client Rollup module report is invalid');
}

const result = assertClientBundleBoundary({ label: 'SvelteKit client', modules, artifacts });
console.log(
  JSON.stringify({
    ...result,
    rollupModules: rollupReport.modules,
    rollupGraphSha256: rollupReport.graphSha256,
    outputDirectories: outputState.directories,
    scannedBytes,
  }),
);
