import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import {
  cpSync,
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
  digest,
  MARKER,
  runBoundedChild,
  runManifest,
  validateManifest,
} from './trace-build-graph.mjs';

const require = createRequire(import.meta.url);
const root = mkdtempSync(path.join(tmpdir(), 'minion-trace-test-'));
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
function manifest(changes = {}) {
  const entry = changes.entry ?? 'entry.cjs';
  const input = {
    version: 1,
    root,
    id,
    entry,
    output: 'trace-results/' + randomUUID(),
    timeoutMs: 5000,
    heapMiB: 512,
    hashes: {},
    ...changes,
  };
  for (const file of [
    'package.json',
    'bun.lock',
    entry,
    'node_modules/@vercel/nft/package.json',
    'node_modules/@vercel/nft/out/index.js',
    'node_modules/@vercel/nft/out/fs.js',
  ]) {
    input.hashes[file] = existsSync(path.join(root, file))
      ? digest(path.join(root, file))
      : '0'.repeat(64);
  }
  const file = path.join(root, 'manifest-' + randomUUID() + '.json');
  writeFileSync(file, JSON.stringify(input));
  return { input, file, save: () => writeFileSync(file, JSON.stringify(input)) };
}

before(() => {
  copyInstalled('@vercel/nft', require);
  writeFileSync(path.join(root, MARKER), JSON.stringify({ version: 1, id }));
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'trace-fixture', private: true }),
  );
  writeFileSync(path.join(root, 'bun.lock'), '{}');
  writeFileSync(
    path.join(root, 'entry.cjs'),
    "require('./dependency.cjs'); const fs=require('node:fs');const path=require('node:path');fs.readFileSync(path.join(__dirname,'asset.txt'),'utf8');",
  );
  writeFileSync(path.join(root, 'dependency.cjs'), 'module.exports = 42;');
  writeFileSync(path.join(root, 'asset.txt'), 'synthetic');
  mkdirSync(path.join(root, 'assets'));
  writeFileSync(path.join(root, 'assets', 'a.txt'), 'one');
  writeFileSync(path.join(root, 'assets', 'b.txt'), 'two');
  writeFileSync(
    path.join(root, 'dynamic.cjs'),
    "const fs=require('node:fs'); const path=require('node:path'); fs.readFileSync(path.join(__dirname,'assets',process.env.TRACE_FILE));",
  );
});
after(() => rmSync(root, { recursive: true, force: true }));

test('actual nft preserves an imported module and an ordinary runtime asset', async () => {
  const { file } = manifest();
  const result = await runManifest(file);
  assert.equal(result.status, 'complete', JSON.stringify(result));
  assert.ok(result.trace.files.includes('dependency.cjs'));
  assert.ok(result.trace.files.includes('asset.txt'));
  assert.ok(result.trace.fileBytes > 0);
});

test('actual nft includes dynamic assets and records their dependency reasons', async () => {
  const { file } = manifest({ entry: 'dynamic.cjs' });
  const result = await runManifest(file);
  assert.equal(result.status, 'complete', JSON.stringify(result));
  assert.ok(result.trace.files.includes('assets/a.txt'));
  assert.ok(result.trace.files.includes('assets/b.txt'));
  const reason = result.trace.reasons.find((item) => item.path === 'assets/a.txt');
  assert.ok(reason.parents.includes('dynamic.cjs'));
});

test('stale marker/hash, absent input and unsafe path are rejected before output creation', () => {
  for (const mutate of [
    (input) => {
      input.id = randomUUID();
    },
    (input) => {
      input.hashes['entry.cjs'] = '0'.repeat(64);
    },
    (input) => {
      input.entry = 'missing.cjs';
    },
    (input) => {
      input.entry = '../outside.cjs';
    },
    (input) => {
      input.output = 'node_modules/overwrite';
    },
    (input) => {
      input.timeoutMs = 60_001;
    },
    (input) => {
      input.heapMiB = 2049;
    },
    (input) => {
      input.root = process.cwd();
    },
  ]) {
    const item = manifest();
    mutate(item.input);
    item.save();
    assert.throws(() => validateManifest(item.file));
    assert.equal(existsSync(path.join(root, item.input.output)), false);
  }
});

test('a previous result cannot be reused as evidence for a fresh execution', async () => {
  const item = manifest();
  assert.equal((await runManifest(item.file)).status, 'complete');
  await assert.rejects(runManifest(item.file), /output_not_empty/);
});

test('missing and symlinked markers reject before reading marker content', () => {
  const file = path.join(root, MARKER);
  const original = readFileSync(file);
  const item = manifest();
  rmSync(file);
  try {
    assert.throws(() => validateManifest(item.file));
  } finally {
    writeFileSync(file, original);
  }
  rmSync(file);
  symlinkSync('/minion-marker-do-not-read', file);
  try {
    assert.throws(() => validateManifest(item.file), /invalid_marker/);
  } finally {
    rmSync(file);
    writeFileSync(file, original);
  }
});

test('escaped symlink and private environment binding reject before tracing', () => {
  const outside = mkdtempSync(path.join(tmpdir(), 'minion-outside-'));
  writeFileSync(path.join(outside, 'data'), 'must not read');
  const link = path.join(root, 'escape');
  try {
    symlinkSync(path.join(outside, 'data'), link);
    assert.throws(() => validateManifest(manifest().file), /symlink_escape/);
  } finally {
    rmSync(link, { force: true });
    rmSync(outside, { recursive: true });
  }
  writeFileSync(path.join(root, '.env'), 'PRIVATE_TOKEN=synthetic\n');
  try {
    assert.throws(() => validateManifest(manifest().file), /private_environment_binding/);
  } finally {
    rmSync(path.join(root, '.env'));
  }
});

test('an outside-root attempted asset is blocked and never called complete', async () => {
  writeFileSync(
    path.join(root, 'outside.cjs'),
    "require('node:fs').readFileSync('/minion-private-do-not-read/file','utf8');",
  );
  const item = manifest({ entry: 'outside.cjs' });
  const result = await runManifest(item.file);
  assert.equal(result.status, 'blocked');
  assert.equal(result.trace.status, 'blocked');
  assert.equal(result.execution.code, 2);
  assert.equal(result.execution.timedOut, false);
  const events = readFileSync(path.join(root, item.input.output, 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(events.at(-1).event, 'blocked');
  assert.equal(events.filter((event) => event.event === 'blocked').length, 1);
});

test('parent timeout stops a stuck child process and cleans its timers', async () => {
  const started = Date.now();
  const result = await runBoundedChild(
    ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
    { cwd: root, timeoutMs: 200 },
  );
  assert.equal(result.timedOut, true);
  assert.ok(Date.now() - started < 3000);
  assert.throws(() => process.kill(result.pid, 0), { code: 'ESRCH' });
});
