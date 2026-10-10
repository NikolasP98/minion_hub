import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

export const SCHEMA_VERSION = 1;
export const WORKER_CONTRACT = 1;
export const SHA256 = /^sha256:[0-9a-f]{64}$/;
export const COMMIT = /^[0-9a-f]{40}$/;
export const BUILD_PIPELINE = [
  'pinned-bun: bun install --frozen-lockfile',
  'pinned-bun: bun install --frozen-lockfile --production --ignore-scripts',
  'pinned-node-network-none: node node_modules/@inlang/paraglide-js/bin/run.js compile --project ./project.inlang --outdir ./src/lib/paraglide',
  'pinned-node-network-none: DESKTOP=1 MINION_WORKER_ARTIFACT_BUILD=1 NOTIFICATION_BUILD_SHA=$SOURCE_SHA node node_modules/vite/bin/vite.js build',
  'pinned-bun-network-none: bun scripts/ops/materialize-worker-dependencies.mjs node_modules.links node_modules',
  'pinned-bun-network-none: bun scripts/ops/build-notification-worker-artifact.mjs',
];

export async function sha256File(file) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw new Error('digest_not_regular_file');
    const digest = createHash('sha256');
    const stream = handle.createReadStream({ autoClose: false, highWaterMark: 1024 * 1024 });
    for await (const chunk of stream) digest.update(chunk);
    const after = await handle.stat({ bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs
    )
      throw new Error('digest_file_changed');
    return `sha256:${digest.digest('hex')}`;
  } finally {
    await handle.close();
  }
}

function exactKeys(value, expected) {
  if (!value || Array.isArray(value) || typeof value !== 'object')
    throw new Error('manifest_object');
  const actual = Object.keys(value).sort();
  if (actual.join('\0') !== [...expected].sort().join('\0')) throw new Error('manifest_keys');
}

export async function verifyArtifact({ archive, manifestFile, expected }) {
  const helper = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    'validate-worker-archive.py',
  );
  const strict = spawnSync('python3', [helper, 'strict-json', manifestFile], { encoding: 'utf8' });
  if (strict.status !== 0) throw new Error(`manifest_json:${strict.stderr.trim()}`);
  const manifest = JSON.parse(strict.stdout);
  exactKeys(manifest, [
    'schemaVersion',
    'workerContract',
    'sourceCommit',
    'sourceTree',
    'lockSha256',
    'archiveSha256',
    'targetOs',
    'targetArch',
    'nodeVersion',
    'nodeAbi',
    'bunVersion',
    'builderImage',
    'dependencyImage',
    'translationPluginSha256',
    'repository',
    'workflow',
    'workflowCommit',
    'workflowSourceCommit',
    'runId',
    'runAttempt',
    'buildPipeline',
  ]);
  if (manifest.schemaVersion !== SCHEMA_VERSION || manifest.workerContract !== WORKER_CONTRACT)
    throw new Error('manifest_contract');
  for (const field of ['sourceCommit', 'sourceTree', 'workflowCommit', 'workflowSourceCommit'])
    if (!COMMIT.test(manifest[field])) throw new Error(`manifest_${field}`);
  for (const field of ['lockSha256', 'archiveSha256'])
    if (!SHA256.test(manifest[field])) throw new Error(`manifest_${field}`);
  if (!['linux'].includes(manifest.targetOs) || !['x64', 'arm64'].includes(manifest.targetArch))
    throw new Error('manifest_target');
  if (!/^v22\.\d+\.\d+$/.test(manifest.nodeVersion) || !/^\d+$/.test(manifest.nodeAbi))
    throw new Error('manifest_node');
  if (!/^\d+\.\d+\.\d+$/.test(manifest.bunVersion)) throw new Error('manifest_bun');
  if (!/^.+@sha256:[0-9a-f]{64}$/.test(manifest.builderImage)) throw new Error('manifest_builder');
  if (!/^.+@sha256:[0-9a-f]{64}$/.test(manifest.dependencyImage))
    throw new Error('manifest_dependency_image');
  if (!SHA256.test(manifest.translationPluginSha256))
    throw new Error('manifest_translation_plugin');
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(manifest.repository) ||
    !/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(manifest.workflow)
  )
    throw new Error('manifest_workflow');
  if (!/^\d+$/.test(manifest.runId) || !/^\d+$/.test(manifest.runAttempt))
    throw new Error('manifest_run');
  if (JSON.stringify(manifest.buildPipeline) !== JSON.stringify(BUILD_PIPELINE))
    throw new Error('manifest_build_pipeline');
  for (const [field, value] of Object.entries(expected)) {
    if (value !== undefined && String(manifest[field]) !== String(value))
      throw new Error(`expected_${field}`);
  }
  const actualArchive = await sha256File(archive);
  if (actualArchive !== manifest.archiveSha256) throw new Error('archive_digest');
  const result = spawnSync('python3', [helper, 'inspect', archive], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`archive_shape:${result.stderr.trim()}`);
  return { manifest, archiveSha256: actualArchive, inventory: JSON.parse(result.stdout) };
}

export async function assertContainedFile(file, root) {
  const [resolvedFile, resolvedRoot] = await Promise.all([realpath(file), realpath(root)]);
  if (resolvedFile !== resolvedRoot && !resolvedFile.startsWith(`${resolvedRoot}${path.sep}`))
    throw new Error('path_outside_root');
}
