import { constants } from 'node:fs';
import { open, lstat, mkdtemp, rm, realpath, chmod } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createB2Client } from './private-worker-artifact-transport.mjs';

export function args(argv) {
  const result = {};
  for (const arg of argv) {
    const at = arg.indexOf('=');
    if (!arg.startsWith('--') || at < 3) throw new Error('arguments');
    const key = arg.slice(2, at);
    if (Object.hasOwn(result, key)) throw new Error('arguments_duplicate');
    result[key] = arg.slice(at + 1);
  }
  return result;
}

export async function loadAuthority(file, { rootOwned = false } = {}) {
  const parent = await realpath(path.dirname(file));
  const parentMetadata = await lstat(parent);
  const expectedUid = rootOwned ? 0 : process.geteuid?.();
  if (
    parent !== path.resolve(path.dirname(file)) ||
    !parentMetadata.isDirectory() ||
    parentMetadata.isSymbolicLink() ||
    parentMetadata.uid !== expectedUid ||
    (parentMetadata.mode & 0o022) !== 0
  )
    throw new Error('authority_parent');
  const metadata = await lstat(file);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('authority_file');
  const mode = metadata.mode & 0o777;
  if ((mode & 0o022) !== 0) throw new Error('authority_writable');
  if (rootOwned && (process.geteuid?.() !== 0 || metadata.uid !== 0))
    throw new Error('authority_requires_root');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes;
  try {
    const opened = await handle.stat();
    if (opened.dev !== metadata.dev || opened.ino !== metadata.ino || opened.size > 64 * 1024)
      throw new Error('authority_changed');
    const buffer = Buffer.allocUnsafe(64 * 1024 + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 64 * 1024) throw new Error('authority_size');
    bytes = buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
  const text = bytes.toString('utf8');
  const value = JSON.parse(text);
  if (`${JSON.stringify(value)}\n` !== text) throw new Error('authority_noncanonical');
  const expected = [
    'bucketId',
    'bucketName',
    'denialBucketName',
    'prefix',
    'region',
    'ownerId',
    'repository',
    'sourceCommit',
    'sourceTree',
    'lockSha256',
    'workflow',
    'workflowCommit',
    'workflowSourceCommit',
    'sourceRef',
    'runId',
    'runAttempt',
    'builderImage',
    'dependencyImage',
    'dependencyVersion',
    'nodeVersion',
    'nodeAbi',
    'translationPluginSha256',
    'archiveSha256',
    'manifestSha256',
    'provenanceSha256',
    'apiOrigin',
    'downloadOrigin',
    's3Origin',
  ];
  if (
    !value ||
    Array.isArray(value) ||
    Object.keys(value).sort().join('\0') !== expected.sort().join('\0')
  )
    throw new Error('authority_keys');
  return value;
}

export function b2FromAuthority(authority, capabilities, fetchImpl = fetch) {
  return createB2Client({ ...authority, capabilities }, fetchImpl);
}

export function verifyOfflineProvenance({ archive, manifest, provenance, authority }) {
  for (const subject of [archive, manifest]) {
    const result = spawnSync(
      'gh',
      [
        'attestation',
        'verify',
        subject,
        '--repo',
        authority.repository,
        '--bundle',
        provenance,
        '--signer-digest',
        authority.workflowCommit,
        '--source-digest',
        authority.workflowSourceCommit,
        '--signer-workflow',
        `github.com/${authority.repository}/${authority.workflow}`,
        '--source-ref',
        authority.sourceRef,
        '--deny-self-hosted-runners',
      ],
      { encoding: 'utf8', timeout: 30_000, env: { PATH: process.env.PATH } },
    );
    if (result.status !== 0) throw new Error('provenance_verify');
  }
}

export function secrets(role) {
  const keyId = process.env[`WORKER_ARTIFACT_B2_${role}_KEY_ID`];
  const applicationKey = process.env[`WORKER_ARTIFACT_B2_${role}_APPLICATION_KEY`];
  if (!keyId || !applicationKey) throw new Error('b2_credentials_missing');
  return { keyId, applicationKey };
}

export async function stageImmutableInputs(inputs) {
  const configuredParent = path.resolve(process.env.RUNNER_TEMP || '/tmp');
  const parent = await realpath(configuredParent);
  const parentMetadata = await lstat(parent);
  if (
    parent !== configuredParent ||
    !parentMetadata.isDirectory() ||
    parentMetadata.isSymbolicLink() ||
    parentMetadata.uid !== process.geteuid?.() ||
    (parentMetadata.mode & 0o022) !== 0
  )
    throw new Error('input_parent_authority');
  const directory = await mkdtemp(path.join(parent, 'worker-inputs-'));
  await chmod(directory, 0o700);
  const staged = {};
  try {
    for (const [name, input] of Object.entries(inputs)) {
      const source = await open(input.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const targetPath = path.join(directory, input.fileName);
      let size = 0;
      try {
        const target = await open(
          targetPath,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
          0o400,
        );
        try {
          const metadata = await source.stat();
          if (!metadata.isFile() || metadata.size < 1 || metadata.size > input.maximum)
            throw new Error(`input_${name}_size`);
          const buffer = Buffer.allocUnsafe(1024 * 1024);
          for (;;) {
            const { bytesRead } = await source.read(buffer, 0, buffer.length, null);
            if (bytesRead === 0) break;
            size += bytesRead;
            if (size > input.maximum) throw new Error(`input_${name}_size`);
            let offset = 0;
            while (offset < bytesRead)
              offset += (await target.write(buffer, offset, bytesRead - offset)).bytesWritten;
          }
          const finalMetadata = await source.stat();
          if (
            size !== metadata.size ||
            finalMetadata.size !== metadata.size ||
            finalMetadata.mtimeMs !== metadata.mtimeMs ||
            finalMetadata.ino !== metadata.ino
          )
            throw new Error(`input_${name}_changed`);
          await target.sync();
        } finally {
          await target.close();
        }
      } finally {
        await source.close();
      }
      staged[name] = { ...input, path: targetPath };
    }
    return {
      directory,
      files: staged,
      cleanup: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
