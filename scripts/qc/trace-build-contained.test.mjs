import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  openSync,
  closeSync,
  readlinkSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  MARKER,
  createManifest,
  runManifest,
  validateManifest,
  sandboxArgs,
  inventory,
  digest,
} from './trace-build-contained.mjs';
const require = createRequire(import.meta.url);
const root = mkdtempSync(path.join(tmpdir(), 'minion-contained-fixture-'));
const id = randomUUID();
const copied = new Set();
function packageRoot(name, caller) {
  let file;
  try {
    file = caller.resolve(name + '/package.json');
  } catch {
    file = caller.resolve(name);
  }
  let directory = path.dirname(realpathSync(file));
  while (directory !== path.dirname(directory)) {
    const candidate = path.join(directory, 'package.json');
    if (existsSync(candidate) && JSON.parse(readFileSync(candidate, 'utf8')).name === name)
      return directory;
    directory = path.dirname(directory);
  }
  throw new Error('Installed fixture dependency missing: ' + name);
}
const sourceModules = path.resolve(
  path.dirname(require.resolve('@vercel/nft/package.json')),
  '../..',
);
function copyInstalled(name, caller) {
  const source = packageRoot(name, caller);
  if (copied.has(source)) return;
  copied.add(source);
  const relative = path.relative(sourceModules, source);
  assert.ok(!relative.startsWith('..'), 'Dependency must be in the installed Hub node_modules');
  const destination = path.join(root, 'node_modules', relative);
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(source, destination, {
    recursive: true,
    filter: (file) => !path.relative(source, file).split(path.sep).includes('node_modules'),
  });
  const metadata = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8'));
  const nested = createRequire(path.join(source, 'package.json'));
  for (const dependency of Object.keys(metadata.dependencies ?? {}))
    copyInstalled(dependency, nested);
}

const runs = [];
const profileReceipts = mkdtempSync(path.join(tmpdir(), 'minion-profile-qualification-'));
function fixture(options = {}, entry = 'entry.cjs') {
  const run = mkdtempSync(path.join(tmpdir(), 'minion-contained-run-'));
  runs.push(run);
  const file = createManifest(root, run, entry, options);
  return { file, run, input: JSON.parse(readFileSync(file, 'utf8')) };
}
before(() => {
  copyInstalled('@vercel/nft', require);
  writeFileSync(path.join(root, MARKER), JSON.stringify({ version: 1, id }));
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'contained-fixture', private: true }),
  );
  writeFileSync(path.join(root, 'bun.lock'), '{}');
  writeFileSync(
    path.join(root, 'entry.cjs'),
    "throw new Error('must not execute handlers'); require('./dependency.cjs'); const fs=require('node:fs');const path=require('node:path');fs.readFileSync(path.join(__dirname,'asset.txt'),'utf8');",
  );
  writeFileSync(path.join(root, 'dependency.cjs'), 'module.exports=42;');
  writeFileSync(path.join(root, 'asset.txt'), 'synthetic');
  mkdirSync(path.join(root, 'assets'));
  writeFileSync(path.join(root, 'assets', 'a.txt'), 'one');
  writeFileSync(path.join(root, 'assets', 'b.txt'), 'two');
  writeFileSync(
    path.join(root, 'dynamic.cjs'),
    "const fs=require('node:fs');const path=require('node:path');fs.readFileSync(path.join(__dirname,'assets',process.env.ASSET));",
  );
  writeFileSync(
    path.join(root, 'absolute.cjs'),
    "const fs=require('node:fs'); const suffix='/__data.json'; console.log(suffix);fs.readFileSync(" +
      JSON.stringify(path.join(root, 'asset.txt')) +
      ",'utf8');",
  );
  writeFileSync(path.join(root, 'missing.cjs'), "require('./missing-required.cjs');");
});
after(() => {
  for (const run of runs) {
    const input = path.join(run, 'input.json');
    if (existsSync(input) && /profile|decode/.test(JSON.parse(readFileSync(input, 'utf8')).mode))
      cpSync(run, path.join(profileReceipts, path.basename(run)), { recursive: true });
  }
  console.log('Profile qualification receipts: ' + profileReceipts);
  for (const run of runs) rmSync(run, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});
test('actual namespace proof precedes nft and retains imports and assets without executing handlers', async () => {
  const item = fixture();
  const sentinel = path.join(item.run, 'inherited-file');
  writeFileSync(sentinel, 'synthetic descriptor sentinel');
  const fd = openSync(sentinel, 'r');
  let result;
  try {
    result = await runManifest(item.file);
  } finally {
    closeSync(fd);
  }
  assert.ok(result.proof.descriptors.every((target) => !target.includes('inherited-file')));
  assert.equal(result.status, 'complete', JSON.stringify(result));
  assert.equal(result.listenerConnections, 0);
  assert.ok(result.proof.parentObserved);
  assert.ok(
    result.execution.stdout.indexOf('isolation-ready') <
      result.execution.stdout.indexOf('nft-loaded'),
  );
  assert.deepEqual(result.identities.before, result.identities.after);
  assert.equal(result.execution.elapsedMs, result.timing.childMs);
  assert.ok(result.timing.totalMs >= result.timing.childMs + result.timing.preflightMs);
  assert.ok(result.timing.manifestPreparationMs >= 0);
  assert.throws(() => validateManifest(item.file), /output_not_fresh/);
  assert.ok(result.trace.files.some((f) => f.path === 'dependency.cjs'));
  assert.ok(result.trace.files.some((f) => f.path === 'asset.txt'));
});
test('actual nft preserves dynamic matches and absolute in-artifact assets; URL suffix is ordinarily absent', async () => {
  const dynamic = await runManifest(fixture({}, 'dynamic.cjs').file);
  assert.equal(dynamic.status, 'complete', JSON.stringify(dynamic));
  assert.ok(
    dynamic.trace.files.some(
      (f) => f.path === 'assets/a.txt' && f.parents.some((p) => p.path === 'dynamic.cjs'),
    ),
  );
  assert.ok(dynamic.trace.files.some((f) => f.path === 'assets/b.txt'));
  const item = fixture({}, 'absolute.cjs'),
    absolute = await runManifest(item.file);
  assert.equal(absolute.status, 'complete', JSON.stringify(absolute));
  assert.ok(absolute.trace.files.some((f) => f.path === 'asset.txt'));
  assert.match(
    readFileSync(path.join(item.run, 'evidence', 'events.jsonl'), 'utf8'),
    /ordinary-absent-stat/,
  );
});
test('a missing required relative dependency is incomplete evidence', async () => {
  const result = await runManifest(fixture({}, 'missing.cjs').file);
  assert.equal(result.status, 'incomplete', JSON.stringify(result));
  assert.ok(result.trace.warningCount > 0);
});
test('probe mode proves isolation without loading nft or analyzing the entry', async () => {
  const result = await runManifest(fixture({ mode: 'probe' }).file);
  assert.equal(result.status, 'probe_complete', JSON.stringify(result));
  assert.doesNotMatch(result.execution.stdout, /nft-loaded|entry-analysis-start/);
});
test('stale identities, unexpected binds, overlapping output and missing entries fail before launch', () => {
  for (const edit of [
    (input) => (input.runtime.files[0].sha256 = '0'.repeat(64)),
    (input) => (input.workerSha256 = '0'.repeat(64)),
    (input) => (input.id = randomUUID()),
    (input) => (input.binds = [['/', '/']]),
    (input) => (input.entry = '../escape'),
    (input) => (input.run = root),
  ]) {
    const item = fixture();
    edit(item.input);
    writeFileSync(item.file, JSON.stringify(item.input));
    assert.throws(() => validateManifest(item.file));
    assert.equal(existsSync(path.join(item.run, 'evidence')), false);
  }
});
test('escaped symlinks, nested private environment and special files reject before any namespace starts', () => {
  const bad = path.join(root, 'bad');
  symlinkSync('/etc/os-release', bad);
  try {
    assert.throws(() => fixture(), /symlink_escape/);
  } finally {
    rmSync(bad);
  }
  const env = path.join(root, 'assets', '.env.local');
  writeFileSync(env, 'PRIVATE=synthetic');
  try {
    assert.throws(() => fixture(), /private_environment_file/);
  } finally {
    rmSync(env);
  }
  assert.equal(spawnSync('/usr/bin/mkfifo', [bad]).status, 0);
  try {
    assert.throws(() => fixture(), /special_artifact_file/);
  } finally {
    rmSync(bad);
  }
});
test('bounded cleanup terminates a SIGTERM-resistant worker and detached descendant', async () => {
  const item = fixture({ mode: 'cleanup-probe', timeoutMs: 2000 });
  const result = await runManifest(item.file);
  assert.equal(result.status, 'timeout', JSON.stringify(result));
  assert.match(result.execution.stdout, /cleanup-descendant/);
  assert.equal(result.listenerConnections, 0);
  assert.ok(result.execution.elapsedMs < 4000);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(existsSync('/proc/' + result.execution.namespacePid), false);
  assert.ok(result.execution.observedDescendants.length >= 2);
  for (const pid of result.execution.observedDescendants)
    assert.equal(existsSync('/proc/' + pid), false);
});

test('actual worker isolation refusal occurs before nft loading and entry analysis', () => {
  const item = fixture();
  const input = validateManifest(item.file);
  mkdirSync(input.output);
  const control = {
    root,
    entry: input.entry,
    mode: 'trace',
    nonce: randomUUID(),
    sentinel: path.join(item.run, 'absent-host-file'),
    markerSha256: '0'.repeat(64),
    runtime: input.runtime,
    workerSha256: input.workerSha256,
    outputBytes: input.outputBytes,
    parentNamespaces: Object.fromEntries(
      ['user', 'pid', 'net', 'ipc', 'uts', 'mnt'].map((name) => [
        name,
        readlinkSync('/proc/self/ns/' + name),
      ]),
    ),
  };
  const file = path.join(item.run, 'negative-control.json');
  writeFileSync(file, JSON.stringify(control));
  const result = spawnSync('/usr/bin/bwrap', sandboxArgs(input, file), {
    env: {},
    encoding: 'utf8',
    timeout: 5000,
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
  });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /probe_identity_mismatch/);
  assert.doesNotMatch(result.stdout, /nft-loaded|entry-analysis-start/);
});

test('Bubblewrap startup refusal cannot execute the diagnostic worker', () => {
  const result = spawnSync(
    '/usr/bin/bwrap',
    [
      '--minion-required-control-unavailable',
      '--',
      '/usr/bin/node',
      '-e',
      "console.log('must-not-start')",
    ],
    { env: {}, encoding: 'utf8', timeout: 5000 },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown option/);
  assert.doesNotMatch(result.stdout, /must-not-start/);
});

test('evidence budget exhaustion stops immediately and never claims complete', async () => {
  const result = await runManifest(fixture({ outputBytes: 1024 }).file);
  assert.equal(result.status, 'output_budget', JSON.stringify(result));
  assert.equal(result.execution.code, 3);
  assert.doesNotMatch(result.execution.stdout, /nft-loaded|entry-analysis-start/);
});

test('a host-side input change invalidates a finished namespace run', async () => {
  const item = fixture({ mode: 'cleanup-probe', timeoutMs: 1800 });
  const pending = runManifest(item.file);
  const ready = path.join(item.run, 'evidence', 'isolation.json');
  const deadline = Date.now() + 5000;
  while (!existsSync(ready)) {
    if (Date.now() > deadline) throw new Error('isolation gate did not complete');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const file = path.join(root, 'asset.txt');
  const original = readFileSync(file);
  try {
    writeFileSync(file, 'changed by fixture owner after isolation');
    const result = await pending;
    assert.equal(result.status, 'input_changed');
    assert.notEqual(result.identities.before, result.identities.after);
  } finally {
    writeFileSync(file, original);
    await pending;
  }
});

test('Bottleneck public defaults require the exact path, bytes and regular package identity', () => {
  const folder = path.join(root, 'node_modules', 'bottleneck');
  assert.equal(existsSync(folder), false);
  mkdirSync(folder);
  const source = packageRoot('bottleneck', require);
  const envFile = path.join(folder, '.env');
  const packageFile = path.join(folder, 'package.json');
  const env = readFileSync(path.join(source, '.env'));
  const metadata = readFileSync(path.join(source, 'package.json'));
  const restore = () => {
    writeFileSync(envFile, env);
    writeFileSync(packageFile, metadata);
  };
  try {
    restore();
    const snapshot = inventory(root);
    assert.deepEqual(
      snapshot.files.find((file) => file.path === 'node_modules/bottleneck/.env'),
      {
        path: 'node_modules/bottleneck/.env',
        bytes: 37,
        sha256: '9a71de52ef575866ca37dce0fe306c2571ed84f780ae2e8a263a6135fc42ac74',
      },
    );
    assert.equal(
      snapshot.files.find((file) => file.path === 'node_modules/bottleneck/package.json').sha256,
      '9e73efe094fc7802ce2288f1e342e9f28c2fe75f017002a96a35a478eb1df4d9',
    );
    const sameLengthChange = Buffer.from(env);
    sameLengthChange[0] ^= 1;
    for (const changed of [
      sameLengthChange,
      Buffer.concat([env, Buffer.from('\n')]),
      Buffer.from('PUBLIC_POSTHOG_KEY=\n'),
    ]) {
      writeFileSync(envFile, changed);
      assert.throws(() => inventory(root));
    }
    restore();
    writeFileSync(packageFile, JSON.stringify({ name: 'bottleneck', version: '2.19.5' }));
    assert.throws(() => inventory(root));
    restore();
    const alternate = path.join(root, 'assets', '.env');
    writeFileSync(alternate, env);
    try {
      assert.throws(() => inventory(root), /private_environment_file/);
    } finally {
      rmSync(alternate);
    }
    const metadataTarget = path.join(folder, 'public-package.json');
    writeFileSync(metadataTarget, metadata);
    rmSync(packageFile);
    symlinkSync(metadataTarget, packageFile);
    assert.throws(() => inventory(root));
    rmSync(packageFile);
    writeFileSync(packageFile, metadata);
    rmSync(metadataTarget);
    const envTarget = path.join(folder, 'public-defaults');
    writeFileSync(envTarget, env);
    rmSync(envFile);
    symlinkSync(envTarget, envFile);
    assert.throws(() => inventory(root), /environment_symlink/);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('profiling retains useful partial ticks after synchronous timeout and built-in decoding', async () => {
  const item = fixture({ mode: 'profile-hot-probe', timeoutMs: 5000 });
  const result = await runManifest(item.file);
  assert.equal(result.status, 'timeout', JSON.stringify(result));
  assert.ok(
    result.proof?.parentObserved,
    JSON.stringify({ execution: result.execution, profile: result.profile }),
  );
  assert.ok(
    result.execution.stderr.indexOf('isolation-ready') <
      result.execution.stderr.indexOf('synthetic-workload-start'),
  );
  const raw = readFileSync(path.join(item.run, 'evidence/profile.v8.log'), 'utf8');
  assert.match(raw, /^tick,/m);
  assert.match(raw, /code-creation,.*minionProfileSyntheticHotLoop/);
  assert.ok(result.profile.lastReceiptMs < result.execution.elapsedMs);
  for (const pid of result.execution.observedDescendants)
    assert.equal(existsSync('/proc/' + pid), false);
  const decoded = fixture({
    mode: 'decode',
    profileFile: path.join(item.run, 'evidence/profile.v8.log'),
    timeoutMs: 5000,
  });
  const output = await runManifest(decoded.file);
  assert.equal(output.status, 'decode_complete', JSON.stringify(output));
  const text = readFileSync(path.join(decoded.run, 'evidence/profile-decoded.txt'), 'utf8');
  assert.match(text, /minionProfileSyntheticHotLoop/);
  assert.ok(output.trace.records.ticks > 0);
  assert.equal(output.identities.profileInputUnchanged, true);
  const cliInput = fixture({
    mode: 'decode',
    profileFile: path.join(item.run, 'evidence/profile.v8.log'),
    timeoutMs: 5000,
  });
  const cli = spawnSync(
    '/usr/bin/node',
    [new URL('./trace-build-contained.mjs', import.meta.url).pathname, '--manifest', cliInput.file],
    { env: {}, encoding: 'utf8', timeout: 10000, maxBuffer: 65536 },
  );
  assert.equal(cli.status, 0, JSON.stringify({ stdout: cli.stdout, stderr: cli.stderr }));
  assert.equal(
    JSON.parse(readFileSync(path.join(cliInput.run, 'process.json'), 'utf8')).status,
    'decode_complete',
  );

  const truncatedSource = syntheticProfileSource(
    Buffer.concat([
      readFileSync(path.join(item.run, 'evidence/profile.v8.log')),
      Buffer.from('incomplete-final-record'),
    ]),
  );
  const truncated = fixture({ mode: 'decode', profileFile: truncatedSource, timeoutMs: 5000 });
  const partial = await runManifest(truncated.file);
  assert.equal(partial.status, 'decode_complete', JSON.stringify(partial.trace));
  assert.ok(partial.trace.discardedTailBytes >= 'incomplete-final-record'.length);
  assert.match(
    readFileSync(path.join(truncated.run, 'evidence/profile-decoded.txt'), 'utf8'),
    /minionProfileSyntheticHotLoop/,
  );
  assert.equal(digest(truncatedSource), partial.trace.originalSha256);
  const bounded = fixture({
    mode: 'decode',
    profileFile: truncatedSource,
    decodeBytes: 1024,
    timeoutMs: 5000,
  });
  const exhausted = await runManifest(bounded.file);
  assert.equal(exhausted.status, 'decode_budget_exhausted', JSON.stringify(exhausted.trace));
  assert.equal(readFileSync(path.join(bounded.run, 'evidence/profile-decoded.txt')).length, 1024);
  assertClosed(exhausted);
});

function assertClosed(result) {
  assert.equal(result.listenerConnections, 0);
  for (const pid of result.execution.observedDescendants)
    assert.equal(existsSync('/proc/' + pid), false);
}
function syntheticProfileSource(data) {
  const source = fixture();
  mkdirSync(path.join(source.run, 'evidence'));
  const file = path.join(source.run, 'evidence/profile.v8.log');
  writeFileSync(file, data);
  return file;
}
test('profile mode preserves actual nft imports, dynamic and absolute assets with useful normal-exit ticks', async () => {
  for (const entry of ['entry.cjs', 'dynamic.cjs', 'absolute.cjs', 'missing.cjs']) {
    const ordinary = await runManifest(fixture({}, entry).file);
    const item = fixture({ mode: 'profile', timeoutMs: 5000 }, entry);
    const profiled = await runManifest(item.file);
    assert.equal(
      profiled.status,
      ordinary.status,
      JSON.stringify({ entry, execution: profiled.execution, profile: profiled.profile }),
    );
    const normalized = (trace) =>
      trace.files
        .map((file) => ({
          ...file,
          parents: file.parents.map((parent) => JSON.stringify(parent)).sort(),
        }))
        .sort((a, b) => a.path.localeCompare(b.path));
    assert.deepEqual(normalized(profiled.trace), normalized(ordinary.trace));
    assert.equal(profiled.trace.warningCount, ordinary.trace.warningCount);
    assert.deepEqual(profiled.trace.warnings, ordinary.trace.warnings);
    assert.equal(profiled.identities.before, profiled.identities.after);
    assert.ok(
      profiled.execution.stderr.indexOf('isolation-ready') <
        profiled.execution.stderr.indexOf('nft-loaded'),
    );
    assertClosed(profiled);
    assert.match(readFileSync(path.join(item.run, 'evidence/profile.v8.log'), 'utf8'), /^tick,/m);
  }
});
test('profile stream hard ceiling and profiled SIGTERM-resistant cleanup remain explicit', async () => {
  const limited = fixture({ mode: 'profile-hot-probe', timeoutMs: 5000, profileBytes: 1024 });
  const output = await runManifest(limited.file);
  assert.equal(output.status, 'profile-budget-exhausted');
  assert.equal(output.profile.persistedBytes, 1024);
  assert.ok(output.profile.discardedBytes > 0);
  assert.equal(readFileSync(path.join(limited.run, 'evidence/profile.v8.log')).length, 1024);
  assertClosed(output);
  const resistant = await runManifest(
    fixture({ mode: 'profile-cleanup-probe', timeoutMs: 5000 }).file,
  );
  assert.equal(resistant.status, 'timeout', JSON.stringify(resistant.execution));
  assert.match(resistant.execution.stderr, /cleanup-descendant/);
  assert.ok(resistant.execution.observedDescendants.length >= 3);
  assertClosed(resistant);
});
test('profile decode refuses missing, escaped, stale or oversized control input', () => {
  const source = syntheticProfileSource('synthetic');
  const normal = fixture({ mode: 'decode', profileFile: source });
  const changed = JSON.parse(readFileSync(normal.file, 'utf8'));
  writeFileSync(changed.profileInput.file, 'different');
  assert.throws(() => validateManifest(normal.file), /profile_identity_mismatch/);
  const wrong = fixture({ mode: 'decode', profileFile: source });
  const wrongInput = JSON.parse(readFileSync(wrong.file, 'utf8'));
  wrongInput.profileInput.file = source;
  writeFileSync(wrong.file, JSON.stringify(wrongInput));
  assert.throws(() => validateManifest(wrong.file), /invalid_profile_input/);
  const linked = fixture({ mode: 'decode', profileFile: source });
  const linkedInput = JSON.parse(readFileSync(linked.file, 'utf8'));
  rmSync(linkedInput.profileInput.file);
  symlinkSync(source, linkedInput.profileInput.file);
  assert.throws(() => validateManifest(linked.file), /invalid_profile_input/);
  assert.throws(() => validateManifest(fixture({ mode: 'decode' }).file), /invalid_profile_input/);
  writeFileSync(source, Buffer.alloc(16 * 1024 * 1024 + 1));
  assert.throws(() => fixture({ mode: 'decode', profileFile: source }), /oversized_profile_input/);
  assert.throws(
    () => validateManifest(fixture({ profileBytes: 1024 }).file),
    /invalid_profile_budget/,
  );
});
test('empty and no-tick partial profiles are unusable without invoking a decoder', async () => {
  for (const bytes of ['', 'code-creation,not-a-complete-profile\nincomplete-tail']) {
    const source = syntheticProfileSource(bytes);
    const input = fixture({ mode: 'decode', profileFile: source, timeoutMs: 5000 });
    const result = await runManifest(input.file);
    assert.equal(result.status, 'profile_unusable', JSON.stringify(result.execution));
    assert.doesNotMatch(result.execution.stdout, /decode-start|nft-loaded/);
    assert.equal(result.identities.profileInputUnchanged, true);
    assertClosed(result);
  }
});

test('profile-enabled isolation failure cannot load nft or admit an application entry', () => {
  const item = fixture({ mode: 'profile', timeoutMs: 5000 });
  const input = validateManifest(item.file);
  mkdirSync(input.output);
  const control = {
    root,
    entry: input.entry,
    mode: 'profile',
    nonce: randomUUID(),
    sentinel: path.join(item.run, 'outside-sentinel'),
    markerSha256: '0'.repeat(64),
    runtime: input.runtime,
    workerSha256: input.workerSha256,
    outputBytes: input.outputBytes,
    parentNamespaces: Object.fromEntries(
      ['user', 'pid', 'net', 'ipc', 'uts', 'mnt'].map((name) => [
        name,
        readlinkSync('/proc/self/ns/' + name),
      ]),
    ),
  };
  const file = path.join(item.run, 'invalid-control.json');
  writeFileSync(file, JSON.stringify(control));
  const result = spawnSync('/usr/bin/bwrap', sandboxArgs(input, file), {
    env: {},
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
  });
  assert.equal(
    result.status,
    2,
    JSON.stringify({ error: result.error?.message, stderr: result.stderr }),
  );
  assert.match(result.stderr, /probe_identity_mismatch/);
  assert.doesNotMatch(result.stderr, /nft-loaded|entry-analysis-start|isolation-ready/);
});

test('malformed tick profile does not become useful decoder evidence', async () => {
  const source = syntheticProfileSource(
    'code-creation,LazyCompile,0,1,0x1,1,synthetic\ntick,malformed\n',
  );
  const input = fixture({ mode: 'decode', profileFile: source, timeoutMs: 5000 });
  const result = await runManifest(input.file);
  assert.ok(
    ['decode_failed', 'profile_unusable'].includes(result.status),
    JSON.stringify(result.trace),
  );
  assertClosed(result);
});

test('profile control overflow retains at most 64KiB of non-ASCII diagnostics', async () => {
  const result = await runManifest(
    fixture({ mode: 'profile-control-overflow-probe', timeoutMs: 5000 }).file,
  );
  assert.equal(result.status, 'output_budget', JSON.stringify(result.execution));
  assert.match(result.execution.stderr, /synthetic-control-overflow/);
  assert.equal(result.profile.controlOverflow, true);
  assert.ok(
    Buffer.byteLength(result.execution.stderr) <= 65536,
    String(Buffer.byteLength(result.execution.stderr)),
  );
  assert.doesNotMatch(result.execution.stderr, /nft-loaded|entry-analysis-start/);
  assertClosed(result);
});
