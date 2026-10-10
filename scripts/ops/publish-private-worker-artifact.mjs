#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256File, verifyArtifact } from './notification-worker-artifact-contract.mjs';
import { OBJECT_MAXIMUMS } from './private-worker-artifact-contract.mjs';
import { publishPrivateArtifactFiles } from './private-worker-artifact-transport.mjs';
import {
  args,
  b2FromAuthority,
  loadAuthority,
  secrets,
  stageImmutableInputs,
  verifyOfflineProvenance,
} from './private-worker-artifact-cli.mjs';

function artifactExpected(authority, archiveSha256) {
  return {
    sourceCommit: authority.sourceCommit,
    sourceTree: authority.sourceTree,
    lockSha256: authority.lockSha256,
    repository: authority.repository,
    workflow: authority.workflow,
    workflowCommit: authority.workflowCommit,
    workflowSourceCommit: authority.workflowSourceCommit,
    runId: authority.runId,
    runAttempt: authority.runAttempt,
    archiveSha256,
    builderImage: authority.builderImage,
    dependencyImage: authority.dependencyImage,
    bunVersion: authority.dependencyVersion,
    nodeVersion: authority.nodeVersion,
    nodeAbi: authority.nodeAbi,
    translationPluginSha256: authority.translationPluginSha256,
  };
}
async function verifyBundle(files, authority) {
  const artifact = await verifyArtifact({
    archive: files.archive.path,
    manifestFile: files.manifest.path,
    expected: artifactExpected(authority, authority.archiveSha256),
  });
  if (
    artifact.archiveSha256 !== authority.archiveSha256 ||
    (await sha256File(files.manifest.path)) !== authority.manifestSha256 ||
    (await sha256File(files.provenance.path)) !== authority.provenanceSha256
  )
    throw new Error('authority_artifact_digest');
  verifyOfflineProvenance({
    archive: files.archive.path,
    manifest: files.manifest.path,
    provenance: files.provenance.path,
    authority,
  });
  return artifact;
}
export async function runPublisher(argv, dependencies = {}) {
  const input = args(argv);
  if (
    Object.keys(input).some(
      (key) => !['authority', 'archive', 'manifest', 'provenance'].includes(key),
    )
  )
    throw new Error('arguments_unknown');
  for (const key of ['authority', 'archive', 'manifest', 'provenance'])
    if (!input[key]) throw new Error(`missing_${key}`);
  const authority = await loadAuthority(input.authority);
  const staged = await stageImmutableInputs({
    archive: {
      path: input.archive,
      fileName: path.basename(input.archive),
      maximum: OBJECT_MAXIMUMS.archive,
    },
    manifest: {
      path: input.manifest,
      fileName: path.basename(input.manifest),
      maximum: OBJECT_MAXIMUMS.manifest,
    },
    provenance: {
      path: input.provenance,
      fileName: path.basename(input.provenance),
      maximum: OBJECT_MAXIMUMS.provenance,
    },
  });
  try {
    const check = dependencies.verifyBundle ?? verifyBundle;
    const artifact = await check(staged.files, authority);
    if (
      authority.prefix !==
      `notification-worker/v1/${authority.sourceCommit}/${artifact.archiveSha256}/`
    )
      throw new Error('authority_prefix_identity');
    const credential = (dependencies.secrets ?? secrets)('PUBLISHER');
    const client = (dependencies.b2FromAuthority ?? b2FromAuthority)(authority, [
      'writeFiles',
      'readFiles',
      'readBuckets',
    ]);
    const auth = await client.authorize(credential.keyId, credential.applicationKey);
    await client.assertPrivate(auth, credential.keyId, credential.applicationKey);
    const receiptFields = Object.fromEntries(
      Object.entries(authority).filter(
        ([key]) =>
          !['ownerId', 'archiveSha256', 'manifestSha256', 'provenanceSha256'].includes(key),
      ),
    );
    Object.assign(receiptFields, {
      schemaVersion: 1,
      disabled: true,
      credentialFree: true,
      activationAuthorized: false,
    });
    return await publishPrivateArtifactFiles({
      client,
      auth,
      files: staged.files,
      receiptFields,
      verifyDownloaded: async (downloaded) =>
        check(
          {
            archive: { path: downloaded.archive },
            manifest: { path: downloaded.manifest },
            provenance: { path: downloaded.provenance },
          },
          authority,
        ),
    });
  } finally {
    await staged.cleanup();
  }
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runPublisher(process.argv.slice(2));
    process.stdout.write(
      `${JSON.stringify({ receiptFileId: result.receiptFileId, receiptSha256: result.receiptSha256 })}\n`,
    );
  } catch {
    process.stderr.write('private_worker_publish_failed\n');
    process.exitCode = 1;
  }
}
