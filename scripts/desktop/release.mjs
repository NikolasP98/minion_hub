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
function required(env, names) {
  for (const name of names)
    if (!env[name]?.trim()) throw Error(`Missing required signing credential: ${name}`);
}
export function prepare(version, platform, signed, env) {
  validate(version, platform);
  const config = { version, bundle: { targets: platforms[platform].targets } };
  if (signed && platform.startsWith('macos')) {
    required(env, [
      'APPLE_CERTIFICATE',
      'APPLE_CERTIFICATE_PASSWORD',
      'APPLE_SIGNING_IDENTITY',
      'APPLE_TEAM_ID',
      'APPLE_API_ISSUER',
      'APPLE_API_KEY',
      'APPLE_API_PRIVATE_KEY',
    ]);
    if (
      !env.APPLE_SIGNING_IDENTITY.startsWith('Developer ID Application: ') ||
      !/^[A-Z0-9]{10}$/.test(env.APPLE_TEAM_ID)
    )
      throw Error('Developer ID Application and Apple team required');
    config.bundle.macOS = { signingIdentity: env.APPLE_SIGNING_IDENTITY };
  }
  if (signed && platform === 'windows-x64') {
    required(env, [
      'AZURE_CLIENT_ID',
      'AZURE_CLIENT_SECRET',
      'AZURE_TENANT_ID',
      'AZURE_SIGNING_ENDPOINT',
      'AZURE_ARTIFACT_SIGNING_ACCOUNT',
      'AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE',
      'WINDOWS_SIGNER_SUBJECT',
    ]);
    if (
      env.AZURE_SIGNING_ENDPOINT.trim() !== env.AZURE_SIGNING_ENDPOINT ||
      !/^https:\/\/[a-z0-9]+\.codesigning\.azure\.net$/.test(env.AZURE_SIGNING_ENDPOINT)
    )
      throw Error('Invalid Azure signing endpoint');
    for (const name of [
      'AZURE_ARTIFACT_SIGNING_ACCOUNT',
      'AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE',
    ]) {
      if (!/^[A-Za-z0-9-]+$/.test(env[name])) throw Error(`Invalid ${name}`);
    }
    config.bundle.windows = {
      signCommand: `artifact-signing-cli -e ${env.AZURE_SIGNING_ENDPOINT} -a ${env.AZURE_ARTIFACT_SIGNING_ACCOUNT} -c ${env.AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE} %1`,
    };
  }
  return config;
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
// A signed receipt is written only after the workflow's OS-native verification.
// Linux payloads receive detached signatures in the assembly job.
export function collect(bundle, out, version, platform, sha, signed) {
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
    signed,
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
    if (receipt.signed !== true) throw Error('Release requires signed build receipts');
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
      `# Minion Hub desktop ${version}`,
      '',
      ...installers.map(
        ({ name, platform }) =>
          `- [Install for ${labels[platform]} (${name.split('.').at(-1)})](${url}/${name})`,
      ),
      '',
      'macOS installers are Developer ID signed and notarized. Windows installers and their embedded app are Authenticode signed. Linux installers have detached OpenPGP signatures (.asc).',
      '',
      `Verify downloads using [SHA256SUMS](${url}/SHA256SUMS), its [signature](${url}/SHA256SUMS.asc), and the independently confirmed release-key fingerprint. The included public key alone is not an identity proof.`,
      '',
      `Source: https://github.com/NikolasP98/minion_hub/commit/${sha}`,
      '',
      'The desktop app loads https://hub.minion-ai.org. Sign in inside the app. No server is bundled.',
      '',
    ].join('\n'),
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, version, platform, sha] = process.argv.slice(2);
  const signed = process.env.DESKTOP_SIGNED === 'true';
  if (command === 'prepare')
    writeFileSync(
      process.env.DESKTOP_CONFIG,
      JSON.stringify(prepare(version, platform, signed, process.env)),
    );
  else if (command === 'collect')
    collect(process.env.DESKTOP_BUNDLE, process.env.DESKTOP_OUTPUT, version, platform, sha, signed);
  else if (command === 'assemble')
    assemble(process.env.DESKTOP_INPUT, process.env.DESKTOP_OUTPUT, version, platform);
  else throw Error(`Unknown command: ${basename(command ?? '')}`);
}
