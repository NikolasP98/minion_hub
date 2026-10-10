#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  mkdir,
  open,
  readFile,
  realpath,
  lstat,
  rm,
  readdir,
  readlink,
  writeFile,
} from 'node:fs/promises';

const COMMIT = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export function validateAdmission(env) {
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw new Error('event');
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.EXPECTED_REPOSITORY ?? '') ||
    env.GITHUB_REPOSITORY !== env.EXPECTED_REPOSITORY
  )
    throw new Error('repository');
  if (env.GITHUB_REF !== 'refs/heads/master') throw new Error('ref');
  if (!COMMIT.test(env.GITHUB_SHA ?? '') || env.GITHUB_WORKFLOW_SHA !== env.GITHUB_SHA)
    throw new Error('workflow_identity');
  if (env.SOURCE_SHA !== env.GITHUB_SHA) throw new Error('source_identity');
  if (!DIGEST.test(env.LOCK_SHA256 ?? '')) throw new Error('lock_identity');
  if (env.PUBLIC_PROVENANCE_APPROVED !== 'true') throw new Error('provenance_approval');
  if (env.LIVE_CONFIG_APPROVED !== 'true') throw new Error('live_config_approval');
}

export async function verifyGh(path, expectedVersion, expectedSha256) {
  if (!/^gh version \d+\.\d+\.\d+$/.test(`gh version ${expectedVersion}`))
    throw new Error('gh_version');
  if (!DIGEST.test(expectedSha256 ?? '')) throw new Error('gh_digest');
  const actual = `sha256:${createHash('sha256')
    .update(await readFile(path))
    .digest('hex')}`;
  if (actual !== expectedSha256) throw new Error('gh_digest');
}

export async function validateLockSources(file) {
  const text = await readFile(file, 'utf8');
  if (/"(?:https?:|git\+|git:|github:|ssh:)/i.test(text)) throw new Error('lock_remote_source');
  for (const match of text.matchAll(/"(file:[^"]+)"/g))
    if (!/^file:deps\/[A-Za-z0-9._-]+\.tgz$/.test(match[1])) throw new Error('lock_local_source');
}

export async function stageBuildSubjects(buildRoot, destination) {
  const root = await realpath(buildRoot);
  if (root !== buildRoot) throw new Error('build_root_canonical');
  const rootStat = await lstat(root);
  if (
    !rootStat.isDirectory() ||
    rootStat.isSymbolicLink() ||
    rootStat.uid !== process.geteuid?.() ||
    (rootStat.mode & 0o077) !== 0
  )
    throw new Error('build_root_authority');
  const artifact = `${root}/notification-worker-artifact`;
  const artifactReal = await realpath(artifact);
  const artifactStat = await lstat(artifact);
  if (
    artifactReal !== artifact ||
    !artifactStat.isDirectory() ||
    artifactStat.isSymbolicLink() ||
    artifactStat.uid !== rootStat.uid ||
    (artifactStat.mode & 0o022) !== 0
  )
    throw new Error('artifact_directory');
  await mkdir(destination, { mode: 0o700 });
  try {
    for (const [name, maximum] of [
      ['minion-hub-notification-worker.tar', 1024 * 1024 * 1024],
      ['manifest.json', 4 * 1024 * 1024],
    ]) {
      const source = await open(`${artifact}/${name}`, constants.O_RDONLY | constants.O_NOFOLLOW);
      let target;
      try {
        target = await open(
          `${destination}/${name}`,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
          0o400,
        );
        const before = await source.stat();
        if (!before.isFile() || before.size < 1 || before.size > maximum)
          throw new Error('subject_file');
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        let copied = 0;
        for (;;) {
          const { bytesRead } = await source.read(buffer, 0, buffer.length, null);
          if (!bytesRead) break;
          copied += bytesRead;
          if (copied > maximum) throw new Error('subject_size');
          let offset = 0;
          while (offset < bytesRead)
            offset += (await target.write(buffer, offset, bytesRead - offset)).bytesWritten;
        }
        const after = await source.stat();
        if (
          copied !== before.size ||
          after.size !== before.size ||
          after.ino !== before.ino ||
          after.mtimeMs !== before.mtimeMs
        )
          throw new Error('subject_changed');
        await target.sync();
      } finally {
        await Promise.allSettled([source.close(), target?.close()]);
      }
    }
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}

async function inventoryEntries(root) {
  const entries = [];
  async function walk(relative) {
    const directory = relative ? `${root}/${relative}` : root;
    for (const name of (await readdir(directory)).sort()) {
      const child = relative ? `${relative}/${name}` : name;
      const file = `${root}/${child}`;
      const metadata = await lstat(file);
      const mode = metadata.mode & 0o777;
      if (metadata.isDirectory()) {
        entries.push({ path: child, type: 'directory', mode });
        await walk(child);
      } else if (metadata.isSymbolicLink()) {
        entries.push({ path: child, type: 'symlink', mode, target: await readlink(file) });
      } else if (metadata.isFile()) {
        const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const digest = createHash('sha256');
          for await (const chunk of handle.createReadStream({ autoClose: false }))
            digest.update(chunk);
          entries.push({
            path: child,
            type: 'file',
            mode,
            size: metadata.size,
            sha256: digest.digest('hex'),
          });
        } finally {
          await handle.close();
        }
      } else throw new Error('inventory_type');
    }
  }
  await walk('');
  return entries;
}

export async function createSourceInventory(root, output) {
  const canonical = await realpath(root);
  if (canonical !== root) throw new Error('inventory_root');
  await writeFile(output, `${JSON.stringify(await inventoryEntries(root))}\n`, {
    flag: 'wx',
    mode: 0o400,
  });
}

export async function verifySourceInventory(root, input) {
  const expected = JSON.parse(await readFile(input, 'utf8'));
  for (const entry of expected) {
    const parts = entry.path.split('/');
    let parent = root;
    for (const part of parts.slice(0, -1)) {
      parent = `${parent}/${part}`;
      const metadata = await lstat(parent);
      if (!metadata.isDirectory() || metadata.isSymbolicLink())
        throw new Error(`source_parent_changed:${entry.path}`);
    }
    const file = `${root}/${entry.path}`;
    const metadata = await lstat(file);
    const mode = metadata.mode & 0o777;
    let actual;
    if (metadata.isDirectory()) actual = { path: entry.path, type: 'directory', mode };
    else if (metadata.isSymbolicLink())
      actual = { path: entry.path, type: 'symlink', mode, target: await readlink(file) };
    else if (metadata.isFile()) {
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const digest = createHash('sha256');
        for await (const chunk of handle.createReadStream({ autoClose: false }))
          digest.update(chunk);
        actual = {
          path: entry.path,
          type: 'file',
          mode,
          size: metadata.size,
          sha256: digest.digest('hex'),
        };
      } finally {
        await handle.close();
      }
    }
    if (JSON.stringify(actual) !== JSON.stringify(entry))
      throw new Error(`source_changed:${entry.path}`);
  }
}

export function validateWorkflowContract(text) {
  const required = [
    'persist-credentials: false',
    'path: source-checkout',
    'path: trusted-publisher',
    'git -C source-checkout archive',
    '--ignore-scripts',
    '--network=none',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    'WORKER_ARTIFACT_PUBLIC_PROVENANCE_APPROVED',
    'WORKER_ARTIFACT_LIVE_CONFIG_APPROVED',
    'WORKER_ARTIFACT_EXPECTED_REPOSITORY',
    'WORKER_ARTIFACT_B2_DENIAL_BUCKET_NAME',
    'WORKER_ARTIFACT_GH_SHA256',
    'WORKER_ARTIFACT_GH_VERSION',
    'trusted-publisher/scripts/ops/run-private-worker-publisher-container.sh',
  ];
  for (const value of required) if (!text.includes(value)) throw new Error(`workflow:${value}`);
  if (/actions\/(upload-artifact|download-artifact)/.test(text)) throw new Error('public_handoff');
  const admission = text.indexOf('Validate dispatch and external approvals');
  const source = text.indexOf('Export immutable tracked source');
  const build = text.indexOf('Build immutable disabled artifact');
  const attest = text.indexOf('Attest archive and manifest');
  const publish = text.indexOf('Publish exact versions and the receipt last');
  if (!(
    admission >= 0 &&
    admission < source &&
    source < build &&
    build < attest &&
    attest < publish
  ))
    throw new Error('workflow_order');
  const publisher = text.slice(publish);
  const buildBlock = text.slice(build, attest);
  if (buildBlock.includes('-v "$PWD:/work"') || buildBlock.includes('/var/run/docker.sock'))
    throw new Error('build_mount');
  if (!buildBlock.includes('-v "$BUILD_ROOT:/work"')) throw new Error('build_copy');
  if (buildBlock.includes('node source-checkout/') || buildBlock.includes('sh source-checkout/'))
    throw new Error('host_source_execution');
  if (publisher.includes('/var/run/docker.sock')) throw new Error('docker_socket');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];
  if (command === 'admit') validateAdmission(process.env);
  else if (command === 'workflow')
    validateWorkflowContract(await readFile(process.argv[3], 'utf8'));
  else if (command === 'gh') await verifyGh(process.argv[3], process.argv[4], process.argv[5]);
  else if (command === 'lock') await validateLockSources(process.argv[3]);
  else if (command === 'stage') await stageBuildSubjects(process.argv[3], process.argv[4]);
  else if (command === 'inventory-create')
    await createSourceInventory(process.argv[3], process.argv[4]);
  else if (command === 'inventory-verify')
    await verifySourceInventory(process.argv[3], process.argv[4]);
  else throw new Error('command');
}
