import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepare } from './release.mjs';
import { updateTargets, verifyUpdate } from './updates.mjs';

export function verifyRelease(
  directory,
  version,
  key = JSON.parse(readFileSync('src-tauri/tauri.conf.json')).plugins.updater.pubkey,
  expectedSource = process.env.DESKTOP_SOURCE_SHA,
) {
  prepare(version, 'linux-x64');
  const manifest = JSON.parse(readFileSync(join(directory, 'desktop-manifest.json')));
  const feed = JSON.parse(readFileSync(join(directory, 'latest.json')));
  if (
    manifest.version !== version ||
    feed.version !== version ||
    !manifest.updaterIntegrity ||
    !/^[a-f0-9]{40}$/.test(manifest.sourceSha) ||
    (expectedSource !== undefined && manifest.sourceSha !== expectedSource)
  )
    throw Error('Release identity mismatch');

  const sums = readFileSync(join(directory, 'SHA256SUMS'), 'utf8').trim().split('\n');
  const verified = new Set();
  for (const line of sums) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9_.-]+)$/.exec(line);
    if (!match || verified.has(match[2])) throw Error('Invalid or duplicate checksum entry');
    const [, digest, name] = match;
    if (
      createHash('sha256')
        .update(readFileSync(join(directory, name)))
        .digest('hex') !== digest
    )
      throw Error(`Release digest mismatch: ${name}`);
    verified.add(name);
  }
  for (const name of [
    'latest.json',
    'desktop-manifest.json',
    ...manifest.installers.map(({ name }) => name),
  ])
    if (!verified.has(name)) throw Error(`Missing release checksum: ${name}`);
  if (Object.keys(feed.platforms).length !== 4 || manifest.installers.length !== 5)
    throw Error('Incomplete release matrix');
  for (const [platform, { target, extension }] of Object.entries(updateTargets)) {
    const name = `Minion-Hub_${version}_${platform}.${extension}`;
    if (!verified.has(name) || !verified.has(`${name}.sig`))
      throw Error('Missing updater checksum');
    const entry = feed.platforms[target];
    if (
      entry?.url !==
      `https://github.com/NikolasP98/minion_hub/releases/download/desktop-v${version}/${name}`
    )
      throw Error('Invalid updater target URL');
    if (readFileSync(join(directory, `${name}.sig`), 'utf8').trim() !== entry.signature)
      throw Error('Feed/signature mismatch');
    verifyUpdate(readFileSync(join(directory, name)), entry.signature, key, version);
  }
  for (const name of readdirSync(directory))
    if (!verified.has(name) && !['SHA256SUMS', 'release-notes.md'].includes(name))
      throw Error('Unverified extra release asset');
  return { version, installers: 5, updaterTargets: 4 };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(verifyRelease(process.env.DESKTOP_OUTPUT, process.env.DESKTOP_VERSION));
}
