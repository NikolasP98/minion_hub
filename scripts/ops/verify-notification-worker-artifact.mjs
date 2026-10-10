#!/usr/bin/env node
import { verifyArtifact } from './notification-worker-artifact-contract.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const index = arg.indexOf('=');
    if (index < 1) throw new Error('arguments must use --name=value');
    return [arg.slice(2, index), arg.slice(index + 1)];
  }),
);
const required = [
  'archive',
  'manifest',
  'manifest-sha256',
  'source-commit',
  'source-tree',
  'archive-sha256',
  'lock-sha256',
  'repository',
  'workflow',
  'workflow-commit',
  'workflow-source-commit',
  'run-id',
  'run-attempt',
  'builder-image',
  'dependency-image',
  'translation-plugin-sha256',
];
for (const key of required) if (!args[key]) throw new Error(`missing_${key}`);
const result = await verifyArtifact({
  archive: args.archive,
  manifestFile: args.manifest,
  expected: {
    sourceCommit: args['source-commit'],
    sourceTree: args['source-tree'],
    archiveSha256: args['archive-sha256'],
    lockSha256: args['lock-sha256'],
    repository: args.repository,
    workflow: args.workflow,
    runId: args['run-id'],
    runAttempt: args['run-attempt'],
    workflowCommit: args['workflow-commit'],
    workflowSourceCommit: args['workflow-source-commit'],
    targetOs: args['target-os'],
    targetArch: args['target-arch'],
    builderImage: args['builder-image'],
    dependencyImage: args['dependency-image'],
    translationPluginSha256: args['translation-plugin-sha256'],
  },
});
const { sha256File } = await import('./notification-worker-artifact-contract.mjs');
if ((await sha256File(args.manifest)) !== args['manifest-sha256'])
  throw new Error('manifest_digest');
process.stdout.write(
  `${JSON.stringify({ archiveSha256: result.archiveSha256, files: result.inventory.length })}\n`,
);
