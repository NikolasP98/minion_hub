#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyArtifact } from './notification-worker-artifact-contract.mjs';
import { FILE_ID, SHA256 } from './private-worker-artifact-contract.mjs';
import { retrievePrivateArtifactFiles } from './private-worker-artifact-transport.mjs';
import {
  args,
  b2FromAuthority,
  loadAuthority,
  secrets,
  verifyOfflineProvenance,
} from './private-worker-artifact-cli.mjs';

export async function runRetriever(argv, dependencies = {}) {
  const input = args(argv);
  if (
    Object.keys(input).some(
      (key) => !['authority', 'receipt-file-id', 'receipt-sha256', 'staging-parent'].includes(key),
    )
  )
    throw new Error('arguments_unknown');
  for (const key of ['authority', 'receipt-file-id', 'receipt-sha256', 'staging-parent'])
    if (!input[key]) throw new Error(`missing_${key}`);
  if (!FILE_ID.test(input['receipt-file-id']) || !SHA256.test(input['receipt-sha256']))
    throw new Error('receipt_external_identity');
  const authority = await (dependencies.loadAuthority ?? loadAuthority)(input.authority, {
    rootOwned: !dependencies.allowDisposableNonRoot,
  });
  const parent = await realpath(input['staging-parent']);
  if (parent !== path.resolve(input['staging-parent'])) throw new Error('staging_parent_authority');
  const metadata = await lstat(parent);
  const expectedUid = dependencies.allowDisposableNonRoot ? process.geteuid?.() : 0;
  if (
    (!dependencies.allowDisposableNonRoot && process.geteuid?.() !== 0) ||
    metadata.uid !== expectedUid ||
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o022) !== 0
  )
    throw new Error('staging_parent_authority');
  const credential = (dependencies.secrets ?? secrets)('READER');
  const client = (dependencies.b2FromAuthority ?? b2FromAuthority)(authority, ['readFiles']);
  const auth = await client.authorize(credential.keyId, credential.applicationKey);
  const directory = path.join(parent, `notification-worker-private-${randomUUID()}`);
  const excluded = new Set(['ownerId', 'archiveSha256', 'manifestSha256', 'provenanceSha256']);
  const expected = Object.fromEntries(
    Object.entries(authority).filter(([key]) => !excluded.has(key)),
  );
  const result = await retrievePrivateArtifactFiles({
    client,
    auth,
    receiptFileId: input['receipt-file-id'],
    receiptSha256: input['receipt-sha256'],
    expected,
    directory,
    verifyProvenance: async ({ receipt, archive, manifest, provenance }) => {
      if (
        receipt.archive.sha256 !== authority.archiveSha256 ||
        receipt.manifest.sha256 !== authority.manifestSha256 ||
        receipt.provenance.sha256 !== authority.provenanceSha256
      )
        throw new Error('authority_artifact_digest');
      await (dependencies.verifyArtifact ?? verifyArtifact)({
        archive,
        manifestFile: manifest,
        expected: {
          sourceCommit: authority.sourceCommit,
          sourceTree: authority.sourceTree,
          lockSha256: authority.lockSha256,
          repository: authority.repository,
          workflow: authority.workflow,
          workflowCommit: authority.workflowCommit,
          workflowSourceCommit: authority.workflowSourceCommit,
          runId: authority.runId,
          runAttempt: authority.runAttempt,
          archiveSha256: receipt.archive.sha256,
          builderImage: authority.builderImage,
          dependencyImage: authority.dependencyImage,
          bunVersion: authority.dependencyVersion,
          nodeVersion: authority.nodeVersion,
          nodeAbi: authority.nodeAbi,
          translationPluginSha256: authority.translationPluginSha256,
        },
      });
      (dependencies.verifyOfflineProvenance ?? verifyOfflineProvenance)({
        archive,
        manifest,
        provenance,
        authority,
      });
    },
  });
  return { directory, sourceCommit: result.receipt.sourceCommit };
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(await runRetriever(process.argv.slice(2)))}\n`);
  } catch {
    process.stderr.write('private_worker_retrieve_failed\n');
    process.exitCode = 1;
  }
}
