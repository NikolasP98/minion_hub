#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, open, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { canonicalReceiptBytes, sha256Bytes } from './private-worker-artifact-contract.mjs';
import { runRetriever } from './retrieve-private-worker-artifact.mjs';

if (process.geteuid?.() !== 0) throw new Error('root_required');
const root = await mkdtemp(path.join(tmpdir(), 'root-private-worker-retriever-'));
try {
  const staging = path.join(root, 'staging');
  await (await import('node:fs/promises')).mkdir(staging, { mode: 0o700 });
  const bytes = {
    archive: Buffer.from('archive'),
    manifest: Buffer.from('{}\n'),
    provenance: Buffer.from('{}\n'),
  };
  const refs = Object.fromEntries(
    Object.entries(bytes).map(([name, value], index) => [
      name,
      {
        fileId: `file_identifier_000${index + 1}`,
        fileName: name === 'archive' ? 'worker.tar' : `${name}.json`,
        size: value.length,
        sha256: sha256Bytes(value),
      },
    ]),
  );
  const authority = {
    bucketId: 'bucket_identifier_123',
    bucketName: 'notification-worker-private',
    denialBucketName: 'notification-worker-denied-canary',
    prefix: `notification-worker/v1/${'a'.repeat(40)}/${refs.archive.sha256}/`,
    region: 'us-west-004',
    ownerId: 'owner-canonical',
    repository: 'NikolasP98/minion_hub',
    sourceCommit: 'a'.repeat(40),
    sourceTree: 'b'.repeat(40),
    lockSha256: `sha256:${'c'.repeat(64)}`,
    workflow: '.github/workflows/notification-worker-private-publish.yml',
    workflowCommit: 'd'.repeat(40),
    workflowSourceCommit: 'e'.repeat(40),
    sourceRef: 'refs/heads/master',
    runId: '1',
    runAttempt: '1',
    builderImage: `node@sha256:${'1'.repeat(64)}`,
    dependencyImage: `bun@sha256:${'2'.repeat(64)}`,
    dependencyVersion: '1.3.1',
    nodeVersion: 'v22.20.0',
    nodeAbi: '127',
    translationPluginSha256: `sha256:${'3'.repeat(64)}`,
    archiveSha256: refs.archive.sha256,
    manifestSha256: refs.manifest.sha256,
    provenanceSha256: refs.provenance.sha256,
    apiOrigin: 'https://api004.backblazeb2.com',
    downloadOrigin: 'https://f004.backblazeb2.com',
    s3Origin: 'https://s3.us-west-004.backblazeb2.com',
  };
  const receipt = {
    ...Object.fromEntries(
      Object.entries(authority).filter(
        ([key]) =>
          !['ownerId', 'archiveSha256', 'manifestSha256', 'provenanceSha256'].includes(key),
      ),
    ),
    schemaVersion: 1,
    disabled: true,
    credentialFree: true,
    activationAuthorized: false,
    ...refs,
  };
  const receiptBytes = canonicalReceiptBytes(receipt);
  const receiptId = 'receipt_file_identifier_0001';
  const objects = new Map([
    [receiptId, receiptBytes],
    ...Object.entries(refs).map(([name, ref]) => [ref.fileId, bytes[name]]),
  ]);
  const client = {
    authorize: async () => ({}),
    downloadFile: async (_auth, fileId, target, maximum) => {
      const value = objects.get(fileId);
      if (!value) throw new Error('fixture_missing');
      if (value.length > maximum) throw new Error('fixture_oversize');
      const handle = await open(target, 'wx', 0o400);
      try {
        await handle.writeFile(value);
        await handle.sync();
      } finally {
        await handle.close();
      }
      return { size: value.length, sha256: sha256Bytes(value) };
    },
  };
  const authorityFile = path.join(root, 'authority.json');
  await writeFile(authorityFile, `${JSON.stringify(authority)}\n`, { mode: 0o400 });
  let selectedClient = client;
  const dependencies = {
    secrets: () => ({ keyId: 'fixture', applicationKey: 'fixture' }),
    b2FromAuthority: () => selectedClient,
    // Full artifact/provenance semantics are exercised by private-worker-artifact.test.mjs.
    verifyArtifact: async () => {},
    verifyOfflineProvenance: () => {},
  };
  for (const [name, target, pattern] of [
    ['linked-parent', staging, /staging_parent_authority/],
    ['dangling-parent', path.join(root, 'absent'), /ENOENT/],
  ]) {
    const linked = path.join(root, name);
    await symlink(target, linked);
    await assert.rejects(
      runRetriever(
        [
          `--authority=${authorityFile}`,
          `--receipt-file-id=${receiptId}`,
          `--receipt-sha256=${sha256Bytes(receiptBytes)}`,
          `--staging-parent=${linked}`,
        ],
        dependencies,
      ),
      pattern,
    );
  }
  const result = await runRetriever(
    [
      `--authority=${authorityFile}`,
      `--receipt-file-id=${receiptId}`,
      `--receipt-sha256=${sha256Bytes(receiptBytes)}`,
      `--staging-parent=${staging}`,
    ],
    dependencies,
  );
  assert.equal(result.sourceCommit, authority.sourceCommit);
  assert.equal(
    (await readdir(result.directory)).sort().join(','),
    'manifest.json,provenance.json,worker.tar',
  );
  await rm(result.directory, { recursive: true });
  const before = await readdir(staging);
  await assert.rejects(
    runRetriever(
      [
        `--authority=${authorityFile}`,
        '--receipt-file-id=missing_file_identifier',
        `--receipt-sha256=${sha256Bytes(receiptBytes)}`,
        `--staging-parent=${staging}`,
      ],
      dependencies,
    ),
    /fixture_missing/,
  );
  assert.deepEqual(await readdir(staging), before);
  selectedClient = {
    ...client,
    downloadFile: async (...arguments_) => {
      const identity = await client.downloadFile(...arguments_);
      if (arguments_[1] === refs.archive.fileId) identity.sha256 = `sha256:${'0'.repeat(64)}`;
      return identity;
    },
  };
  await assert.rejects(
    runRetriever(
      [
        `--authority=${authorityFile}`,
        `--receipt-file-id=${receiptId}`,
        `--receipt-sha256=${sha256Bytes(receiptBytes)}`,
        `--staging-parent=${staging}`,
      ],
      dependencies,
    ),
    /archive_identity/,
  );
  assert.deepEqual(await readdir(staging), before);
  process.stdout.write('root private worker retriever: success and cleanup PASS\n');
} finally {
  await rm(root, { recursive: true, force: true });
}
