import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepare, collect, assemble, platforms } from './release.mjs';

const version = '1.2.3';
const sha = 'a'.repeat(40);
function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'desktop-release-'));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('rejects shell/URL/path injection and non-stable versions before building', () => {
  for (const input of ['v1.2.3', '../1.2.3', '1.2.3\n', '1.2.3-rc1', '1.2.3;echo bad', '01.2.3']) {
    assert.throws(() => prepare(input, 'linux-x64', false, {}));
  }
  assert.throws(() => prepare(version, '../linux', false, {}));
});

test('signed build never falls back when Apple or Windows identity is absent', () => {
  assert.throws(() => prepare(version, 'macos-arm64', true, {}), /APPLE/);
  assert.throws(() => prepare(version, 'windows-x64', true, {}), /AZURE/);
  const env = {
    APPLE_CERTIFICATE: 'x',
    APPLE_CERTIFICATE_PASSWORD: 'x',
    APPLE_SIGNING_IDENTITY: '-',
    APPLE_TEAM_ID: 'AAAAAAAAAA',
    APPLE_API_ISSUER: 'x',
    APPLE_API_KEY: 'x',
    APPLE_API_PRIVATE_KEY: 'x',
  };
  assert.throws(() => prepare(version, 'macos-arm64', true, env), /Developer ID/);
  assert.deepEqual(prepare(version, 'linux-x64', false, {}).bundle.targets, ['deb', 'appimage']);
});

test('collect rejects missing or ambiguous installers; assembly rejects unsigned and incomplete sets', () =>
  fixture((root) => {
    const bundle = join(root, 'bundle');
    mkdirSync(bundle);
    assert.throws(
      () => collect(bundle, join(root, 'out'), version, 'linux-x64', sha, false),
      /Expected one/,
    );
    assert.throws(() => assemble(root, join(root, 'release'), version, sha), /Missing/);
    writeFileSync(join(bundle, 'first.deb'), 'one');
    writeFileSync(join(bundle, 'second.deb'), 'two');
    writeFileSync(join(bundle, 'first.AppImage'), 'three');
    assert.throws(
      () => collect(bundle, join(root, 'out'), version, 'linux-x64', sha, false),
      /Expected one/,
    );
  }));

function populate(root, signed = true) {
  for (const [platform, spec] of Object.entries(platforms)) {
    const bundle = join(root, 'build', platform);
    mkdirSync(bundle, { recursive: true });
    for (const ext of spec.extensions)
      writeFileSync(join(bundle, `app.${ext}`), `${platform}:${ext}`);
    collect(bundle, join(root, 'inputs', platform), version, platform, sha, signed);
  }
}

test('complete matrix yields exact release links, hashes and source identity', () =>
  fixture((root) => {
    populate(root);
    assemble(join(root, 'inputs'), join(root, 'release'), version, sha);
    const manifest = JSON.parse(readFileSync(join(root, 'release', 'desktop-manifest.json')));
    assert.equal(manifest.sourceSha, sha);
    assert.equal(manifest.installers.length, 5);
    const notes = readFileSync(join(root, 'release', 'release-notes.md'), 'utf8');
    assert.match(
      notes,
      /NikolasP98\/minion_hub\/releases\/download\/desktop-v1.2.3\/Minion-Hub_1.2.3_windows-x64.exe/,
    );
    assert.equal(
      readFileSync(join(root, 'release', 'SHA256SUMS'), 'utf8')
        .trim()
        .split('\n').length,
      6,
    );
  }));

test('qualification artifacts cannot enter a signed release', () =>
  fixture((root) => {
    populate(root, false);
    assert.throws(
      () => assemble(join(root, 'inputs'), join(root, 'release'), version, sha),
      /signed/,
    );
  }));

test('modified installers and wrong revision receipts fail release assembly', () =>
  fixture((root) => {
    populate(root);
    const file = join(root, 'inputs/linux-x64/Minion-Hub_1.2.3_linux-x64.deb');
    writeFileSync(file, 'tampered');
    assert.throws(
      () => assemble(join(root, 'inputs'), join(root, 'release'), version, sha),
      /digest/,
    );
    assert.throws(
      () => assemble(join(root, 'inputs'), join(root, 'release'), version, 'b'.repeat(40)),
      /identity/,
    );
  }));
