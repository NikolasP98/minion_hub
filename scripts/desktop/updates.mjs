import { createHash, createPublicKey, verify } from 'node:crypto';
import { cpSync, existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { prepare } from './release.mjs';

export const updateTargets = Object.freeze({
  'linux-x64': { target: 'linux-x86_64', extension: 'AppImage' },
  'windows-x64': { target: 'windows-x86_64', extension: 'exe' },
  'macos-arm64': { target: 'darwin-aarch64', extension: 'app.tar.gz' },
  'macos-x64': { target: 'darwin-x86_64', extension: 'app.tar.gz' },
});
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const publicKey = () =>
  process.env.DESKTOP_UPDATER_PUBLIC_KEY ||
  JSON.parse(readFileSync('src-tauri/tauri.conf.json')).plugins.updater.pubkey;

// Decode the minisign envelope; Node's maintained Ed25519/BLAKE2b primitives do
// the cryptography. Both the payload and trusted version comment must verify.
export function verifyUpdate(bytes, signature, pubkey, version) {
  const key = Buffer.from(pubkey, 'base64').toString('utf8').trim().split('\n');
  const lines = Buffer.from(signature, 'base64').toString('utf8').trim().split('\n');
  if (key.length !== 2 || lines.length !== 4 || !lines[2].startsWith('trusted comment: '))
    throw Error('Invalid updater signature envelope');
  const rawKey = Buffer.from(key[1], 'base64');
  const rawSig = Buffer.from(lines[1], 'base64');
  const global = Buffer.from(lines[3], 'base64');
  if (
    rawKey.length !== 42 ||
    rawSig.length !== 74 ||
    global.length !== 64 ||
    rawKey.subarray(0, 2).toString() !== 'Ed' ||
    rawSig.subarray(0, 2).toString() !== 'ED' ||
    !rawKey.subarray(2, 10).equals(rawSig.subarray(2, 10))
  )
    throw Error('Invalid updater signature key');
  const comment = lines[2].slice('trusted comment: '.length);
  if (
    comment
      .split('\t')
      .filter((field) => field.startsWith('version:'))
      .join() !== `version:${version}`
  )
    throw Error('Updater signature version mismatch');
  const spki = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), rawKey.subarray(10)]),
    format: 'der',
    type: 'spki',
  });
  const payloadSignature = rawSig.subarray(10);
  if (
    !verify(null, createHash('blake2b512').update(bytes).digest(), spki, payloadSignature) ||
    !verify(null, Buffer.concat([payloadSignature, Buffer.from(comment)]), spki, global)
  )
    throw Error('Updater signature verification failed');
}

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name),
      stat = lstatSync(path);
    if (stat.isSymbolicLink()) return [];
    if (stat.isDirectory() && (name.endsWith('.app') || name.endsWith('.AppDir'))) return [];
    return stat.isDirectory() ? files(path) : [path];
  });
}

export function collectUpdates(
  bundle,
  out,
  version,
  platform,
  sourceSha,
  key = publicKey(),
  sign = true,
) {
  prepare(version, platform);
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw Error('Expected exact source SHA');
  const spec = updateTargets[platform];
  const matches = files(bundle).filter((file) => file.endsWith(`.${spec.extension}`));
  if (matches.length !== 1) throw Error(`Expected one updater artifact for ${platform}`);
  const file = matches[0];
  if (sign) {
    // --no-sign keeps OS signing optional. Explicitly sign only the free updater
    // integrity envelope, binding its trusted comment to the announced version.
    const result = spawnSync(
      process.execPath,
      ['node_modules/@tauri-apps/cli/tauri.js', 'signer', 'sign', '--app-version', version, file],
      { encoding: 'utf8' },
    );
    if (result.status !== 0)
      throw Error('Updater integrity signing failed (key contents suppressed)');
  }
  const signature = readFileSync(`${file}.sig`, 'utf8').trim();
  const bytes = readFileSync(file);
  verifyUpdate(bytes, signature, key, version);
  const name = `Minion-Hub_${version}_${platform}.${spec.extension}`;
  if (existsSync(join(out, name))) {
    if (sha256(readFileSync(join(out, name))) !== sha256(bytes))
      throw Error('Installer/updater bytes differ');
  } else cpSync(file, join(out, name));
  writeFileSync(join(out, `${name}.sig`), signature + '\n');
  const receipt = {
    version,
    sourceSha,
    platform,
    pubkey: key,
    name,
    signature,
    sha256: sha256(bytes),
  };
  writeFileSync(join(out, `updater-${platform}.json`), JSON.stringify(receipt, null, 2) + '\n');
}

export function assembleUpdates(input, out, version, sourceSha, key = publicKey()) {
  const feed = {
    version,
    notes: `Minion Hub desktop ${version}`,
    pub_date: new Date().toISOString(),
    platforms: {},
  };
  const assets = [];
  for (const [platform, spec] of Object.entries(updateTargets)) {
    prepare(version, platform);
    const receipt = JSON.parse(readFileSync(join(input, platform, `updater-${platform}.json`)));
    const name = `Minion-Hub_${version}_${platform}.${spec.extension}`;
    if (
      receipt.version !== version ||
      receipt.sourceSha !== sourceSha ||
      receipt.platform !== platform ||
      receipt.name !== name ||
      receipt.pubkey !== key
    )
      throw Error('Updater receipt identity mismatch');
    const bytes = readFileSync(join(input, platform, name));
    if (sha256(bytes) !== receipt.sha256) throw Error('Updater digest mismatch');
    verifyUpdate(bytes, receipt.signature, key, version);
    if (existsSync(join(out, name)) && sha256(readFileSync(join(out, name))) !== receipt.sha256)
      throw Error('Installer/updater bytes differ');
    cpSync(join(input, platform, name), join(out, name));
    writeFileSync(join(out, `${name}.sig`), receipt.signature + '\n');
    feed.platforms[spec.target] = {
      signature: receipt.signature,
      url: `https://github.com/NikolasP98/minion_hub/releases/download/desktop-v${version}/${name}`,
    };
    assets.push(name, `${name}.sig`);
  }
  writeFileSync(join(out, 'latest.json'), JSON.stringify(feed, null, 2) + '\n');
  const manifestPath = join(out, 'desktop-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath));
  manifest.updaterIntegrity = true;
  manifest.updaterKeySha256 = sha256(Buffer.from(key));
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  const names = [
    ...new Set([
      ...manifest.installers.map(({ name }) => name),
      ...assets,
      'latest.json',
      'desktop-manifest.json',
    ]),
  ].sort();
  writeFileSync(
    join(out, 'SHA256SUMS'),
    names.map((name) => `${sha256(readFileSync(join(out, name)))}  ${name}\n`).join(''),
  );
  writeFileSync(
    join(out, 'release-notes.md'),
    readFileSync(join(out, 'release-notes.md'), 'utf8') +
      '\nThis release checks for desktop updates at startup and every six hours while running. AppImage, Windows and macOS install verified updates automatically at startup. Active sessions receive a notice and choose when to restart. Debian packages use the package manager. Version 0.0.1 needs this one-time installer download to enable updates. Updater integrity signatures are free and separate from OS publisher signing.\n',
  );
}

export function assertNewerFeed(previous, next) {
  prepare(next.version, 'linux-x64');
  if (!previous) return;
  prepare(previous.version, 'linux-x64');
  const left = next.version.split('.').map(BigInt),
    right = previous.version.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (left[i] > right[i]) return;
    if (left[i] < right[i]) break;
  }
  throw Error('Feed publication must advance the desktop version');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, version, platform, sourceSha] = process.argv.slice(2);
  if (command === 'collect')
    collectUpdates(
      process.env.DESKTOP_BUNDLE,
      process.env.DESKTOP_OUTPUT,
      version,
      platform,
      sourceSha,
    );
  else if (command === 'assemble')
    assembleUpdates(process.env.DESKTOP_INPUT, process.env.DESKTOP_OUTPUT, version, platform);
  else if (command === 'advance')
    assertNewerFeed(
      existsSync(process.env.DESKTOP_PREVIOUS_FEED)
        ? JSON.parse(readFileSync(process.env.DESKTOP_PREVIOUS_FEED))
        : null,
      JSON.parse(readFileSync(join(process.env.DESKTOP_OUTPUT, 'latest.json'))),
    );
  else throw Error(`Unknown updater command: ${basename(command ?? '')}`);
}
