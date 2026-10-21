import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const platforms = Object.freeze({
  'linux-x64': { extensions: ['deb', 'AppImage'], targets: ['deb', 'appimage'] },
  'windows-x64': { extensions: ['exe'], targets: ['nsis'] },
  'macos-arm64': { extensions: ['dmg'], targets: ['dmg'] },
  'macos-x64': { extensions: ['dmg'], targets: ['dmg'] },
});
function validate(version, platform, sha) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || version.trim() !== version)
    throw Error('Expected stable version X.Y.Z');
  if (platform !== undefined && !Object.hasOwn(platforms, platform))
    throw Error('Unknown platform');
  if (sha !== undefined && (sha.length !== 40 || !/^[a-f0-9]{40}$/.test(sha)))
    throw Error('Expected exact source SHA');
}
export function prepare(version, platform) {
  validate(version, platform);
  return { version, bundle: { targets: platforms[platform].targets } };
}
function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return [];
    if (stat.isDirectory() && (name.endsWith('.app') || name.endsWith('.AppDir'))) return [];
    return stat.isDirectory() ? files(path) : [path];
  });
}
function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
const assetName = (version, platform, ext) => `Minion-Hub_${version}_${platform}.${ext}`;
export function collect(bundle, out, version, platform, sha) {
  validate(version, platform, sha);
  const all = files(bundle);
  const installers = platforms[platform].extensions.map((ext) => {
    const matches = all.filter((file) => file.endsWith(`.${ext}`));
    if (matches.length !== 1)
      throw Error(`Expected one ${ext} installer for ${platform}; found ${matches.length}`);
    return { path: matches[0], name: assetName(version, platform, ext) };
  });
  mkdirSync(out, { recursive: true });
  for (const file of installers)
    cpSync(file.path, join(out, file.name), { errorOnExist: true, force: false });
  const receipt = {
    version,
    sourceSha: sha,
    platform,
    signed: false,
    installers: installers.map(({ name }) => ({ name, sha256: digest(join(out, name)) })),
  };
  writeFileSync(join(out, `${platform}.json`), JSON.stringify(receipt, null, 2) + '\n');
}
export function assemble(input, out, version, sha) {
  validate(version, undefined, sha);
  const installers = [];
  for (const [platform, spec] of Object.entries(platforms)) {
    const receiptPath = join(input, platform, `${platform}.json`);
    if (!existsSync(receiptPath)) throw Error(`Missing ${platform} receipt`);
    const receipt = JSON.parse(readFileSync(receiptPath));
    if (receipt.version !== version || receipt.sourceSha !== sha || receipt.platform !== platform)
      throw Error('Receipt identity mismatch');
    if (receipt.signed !== false) throw Error('Expected unsigned preview build receipt');
    if (receipt.installers?.length !== spec.extensions.length)
      throw Error('Installer count mismatch');
    for (const ext of spec.extensions) {
      const name = assetName(version, platform, ext);
      const file = join(input, platform, name);
      const entry = receipt.installers.find((item) => item.name === name);
      if (!entry || !lstatSync(file).isFile() || digest(file) !== entry.sha256)
        throw Error(`Installer digest mismatch: ${name}`);
      installers.push({ name, sha256: entry.sha256, platform });
    }
  }
  mkdirSync(out, { recursive: false });
  for (const { name, platform } of installers) cpSync(join(input, platform, name), join(out, name));
  const manifest = {
    version,
    sourceSha: sha,
    hostedOrigin: 'https://hub.minion-ai.org',
    signed: false,
    channel: 'unsigned-preview',
    installers,
  };
  writeFileSync(join(out, 'desktop-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const sums = [
    ...installers,
    { name: 'desktop-manifest.json', sha256: digest(join(out, 'desktop-manifest.json')) },
  ];
  writeFileSync(
    join(out, 'SHA256SUMS'),
    sums.map(({ name, sha256 }) => `${sha256}  ${name}\n`).join(''),
  );
  const url = `https://github.com/NikolasP98/minion_hub/releases/download/desktop-v${version}`;
  const labels = {
    'linux-x64': 'Linux x64',
    'windows-x64': 'Windows x64',
    'macos-arm64': 'macOS Apple Silicon',
    'macos-x64': 'macOS Intel',
  };
  writeFileSync(
    join(out, 'release-notes.md'),
    [
      `# Minion Hub desktop ${version} — unsigned preview`,
      '',
      ...installers.map(
        ({ name, platform }) =>
          `- [Install for ${labels[platform]} (${name.split('.').at(-1)})](${url}/${name})`,
      ),
      '',
      'These installers are unsigned and macOS builds are not notarized. Windows SmartScreen and macOS Gatekeeper may block launch or show warnings. No signing accounts or certificates are required to download this preview.',
      '',
      `Verify downloaded files against [SHA256SUMS](${url}/SHA256SUMS). Checksums detect changed bytes; they are not publisher signatures.`,
      '',
      `Source: https://github.com/NikolasP98/minion_hub/commit/${sha}`,
      '',
      'The desktop app loads https://hub.minion-ai.org. Sign in inside the app. No server is bundled.',
      '',
      'Early preview: native tests and installer packaging passed on all four targets. Installed sign-in, restart persistence, deep links and file drops have not yet been qualified on every OS.',
      '',
    ].join('\n'),
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, version, platform, sha] = process.argv.slice(2);
  if (command === 'prepare')
    writeFileSync(process.env.DESKTOP_CONFIG, JSON.stringify(prepare(version, platform)));
  else if (command === 'collect')
    collect(process.env.DESKTOP_BUNDLE, process.env.DESKTOP_OUTPUT, version, platform, sha);
  else if (command === 'assemble')
    assemble(process.env.DESKTOP_INPUT, process.env.DESKTOP_OUTPUT, version, platform);
  else throw Error(`Unknown command: ${basename(command ?? '')}`);
}
