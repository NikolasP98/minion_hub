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

test('all platforms build without signing credentials', () => {
  assert.deepEqual(prepare(version, 'linux-x64').bundle.targets, ['deb', 'appimage']);
  assert.deepEqual(prepare(version, 'windows-x64').bundle.targets, ['nsis']);
  assert.deepEqual(prepare(version, 'macos-arm64').bundle.targets, ['dmg']);
  assert.deepEqual(prepare(version, 'macos-x64').bundle.targets, ['dmg']);
});

test('collect rejects missing or ambiguous installers; assembly rejects incomplete sets', () =>
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

function populate(root) {
  for (const [platform, spec] of Object.entries(platforms)) {
    const bundle = join(root, 'build', platform);
    mkdirSync(bundle, { recursive: true });
    for (const ext of spec.extensions)
      writeFileSync(join(bundle, `app.${ext}`), `${platform}:${ext}`);
    collect(bundle, join(root, 'inputs', platform), version, platform, sha);
  }
}

test('complete matrix yields exact release links, hashes and source identity', () =>
  fixture((root) => {
    populate(root);
    assemble(join(root, 'inputs'), join(root, 'release'), version, sha);
    const manifest = JSON.parse(readFileSync(join(root, 'release', 'desktop-manifest.json')));
    assert.equal(manifest.sourceSha, sha);
    assert.equal(manifest.installers.length, 5);
    assert.equal(manifest.signed, false);
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

test('unsigned previews are labeled honestly and never claim notarization', () =>
  fixture((root) => {
    populate(root);
    assemble(join(root, 'inputs'), join(root, 'release'), version, sha);
    const notes = readFileSync(join(root, 'release', 'release-notes.md'), 'utf8');
    assert.match(notes, /unsigned preview/i);
    assert.match(notes, /not notarized/i);
    assert.doesNotMatch(notes, /are Developer ID signed|Authenticode signed|release-key.asc/);
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

test('unsigned preview receipts cannot falsely claim a signature', () =>
  fixture((root) => {
    populate(root);
    const path = join(root, 'inputs/linux-x64/linux-x64.json');
    const receipt = JSON.parse(readFileSync(path));
    receipt.signed = true;
    writeFileSync(path, JSON.stringify(receipt));
    assert.throws(
      () => assemble(join(root, 'inputs'), join(root, 'release'), version, sha),
      /Expected unsigned/,
    );
  }));
