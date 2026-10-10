#!/usr/bin/env node
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  BUILD_PIPELINE,
  COMMIT,
  SCHEMA_VERSION,
  WORKER_CONTRACT,
  sha256File,
} from './notification-worker-artifact-contract.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const index = arg.indexOf('=');
    if (index < 1) throw new Error('arguments must use --name=value');
    return [arg.slice(2, index), arg.slice(index + 1)];
  }),
);
const required = [
  'output',
  'repository',
  'workflow',
  'workflow-commit',
  'workflow-source-commit',
  'run-id',
  'run-attempt',
  'builder-image',
  'dependency-image',
  'bun-version',
  'target-node-version',
  'target-node-abi',
  'translation-plugin-sha256',
];
for (const key of required) if (!args[key]) throw new Error(`missing_${key}`);
if (!args['builder-image'].match(/^.+@sha256:[0-9a-f]{64}$/))
  throw new Error('builder_image_not_immutable');
if (!args['dependency-image'].match(/^.+@sha256:[0-9a-f]{64}$/))
  throw new Error('dependency_image_not_immutable');

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(`command_failed:${command}`);
}
function output(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`command_failed:${command}`);
  return result.stdout.trim();
}

const root = process.cwd();
const sourceCommit = args['source-commit'] ?? output('git', ['rev-parse', 'HEAD']);
const sourceTree = args['source-tree'] ?? output('git', ['rev-parse', 'HEAD^{tree}']);
if (!COMMIT.test(sourceCommit) || !COMMIT.test(sourceTree)) throw new Error('source_identity');
if (!args['source-commit']) {
  const dirty = output('git', ['status', '--porcelain=v1', '--untracked-files=no']);
  if (dirty && !(args['payload-dir'] && process.env.MINION_ARTIFACT_TEST === '1'))
    throw new Error('dirty_source');
} else if (process.env.MINION_PINNED_BUILDER !== '1')
  throw new Error('external_identity_requires_pinned_builder');
const target = path.resolve(args.output);
await mkdir(target, { recursive: true });
const temporary = await mkdtemp(path.join(tmpdir(), 'minion-worker-artifact-'));
try {
  const payload = path.join(temporary, 'payload');
  await mkdir(payload);
  if (args['payload-dir']) {
    await cp(path.resolve(args['payload-dir']), payload, { recursive: true, force: false });
  } else {
    throw new Error('prepared_payload_required');
  }
  run('node', [path.join(root, 'scripts/ops/worker-payload-integrity.mjs'), 'create', payload]);
  const archive = path.join(target, 'minion-hub-notification-worker.tar');
  run('tar', [
    '--format=gnu',
    '--sort=name',
    '--mtime=@0',
    '--owner=0',
    '--group=0',
    '--numeric-owner',
    '-cf',
    archive,
    '-C',
    payload,
    '.',
  ]);
  const lockSha256 = await sha256File(path.join(root, 'bun.lock'));
  const archiveSha256 = await sha256File(archive);
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    workerContract: WORKER_CONTRACT,
    sourceCommit,
    sourceTree,
    lockSha256,
    archiveSha256,
    targetOs: 'linux',
    targetArch: process.arch,
    nodeVersion: args['target-node-version'],
    nodeAbi: args['target-node-abi'],
    bunVersion: args['bun-version'],
    builderImage: args['builder-image'],
    dependencyImage: args['dependency-image'],
    translationPluginSha256: args['translation-plugin-sha256'],
    repository: args.repository,
    workflow: args.workflow,
    workflowCommit: args['workflow-commit'],
    workflowSourceCommit: args['workflow-source-commit'],
    runId: args['run-id'],
    runAttempt: args['run-attempt'],
    buildPipeline: BUILD_PIPELINE,
  };
  await writeFile(path.join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o444,
  });
  process.stdout.write(
    `${JSON.stringify({ archive, manifest: path.join(target, 'manifest.json'), archiveSha256 })}\n`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
