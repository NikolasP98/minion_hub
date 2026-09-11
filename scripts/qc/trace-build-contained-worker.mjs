import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { createInterface } from 'node:readline';
import {
  appendFileSync,
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const control = JSON.parse(readFileSync('/qc/control.json', 'utf8'));
const profiling = [
  'profile',
  'profile-hot-probe',
  'profile-control-overflow-probe',
  'profile-cleanup-probe',
].includes(control.mode);
const announce = (value) =>
  (profiling ? process.stderr : process.stdout).write(JSON.stringify(value) + '\n');
const hash = (data) => createHash('sha256').update(data).digest('hex');
const digest = (file) => hash(readFileSync(file));
const fail = (code) => {
  throw new Error(code);
};
const started = performance.now();
let written = 0;
function write(file, value, append = false) {
  const data = JSON.stringify(value) + '\n';
  if (written + Buffer.byteLength(data) > control.outputBytes) {
    // nft catches optional-asset hook errors; an exhausted evidence budget must stop the isolated process.
    console.error(JSON.stringify({ event: 'output-budget-exhausted' }));
    process.exit(3);
  }
  written += Buffer.byteLength(data);
  (append ? appendFileSync : writeFileSync)('/evidence/' + file, data);
}
function absent(file) {
  try {
    lstatSync(file);
    return false;
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) return true;
    throw error;
  }
}
function readonly(file, create = false) {
  try {
    const fd = openSync(file, create ? 'wx' : 'r+');
    closeSync(fd);
    fail('writable_protected_path');
  } catch (error) {
    if (!['EROFS', 'EACCES', 'EPERM'].includes(error.code)) throw error;
  }
}
async function isolation() {
  const status = readFileSync('/proc/self/status', 'utf8');
  if (!/^NoNewPrivs:\s+1$/m.test(status) || !/^CapEff:\s+0+$/m.test(status))
    fail('privilege_controls_missing');
  if (process.cwd() !== '/' || Object.keys(process.env).some((key) => key !== 'PWD'))
    fail('unexpected_process_environment');
  const namespaces = Object.fromEntries(
    Object.keys(control.parentNamespaces).map((name) => [
      name,
      readlinkSync(`/proc/self/ns/${name}`),
    ]),
  );
  for (const [name, value] of Object.entries(namespaces))
    if (value === control.parentNamespaces[name]) fail('shared_namespace');
  if (Object.keys(networkInterfaces()).some((name) => name !== 'lo'))
    fail('network_interface_exposed');
  for (const file of [
    control.sentinel,
    '/home',
    '/etc/os-release',
    '/__data.json',
    '/minion/setup/setup.sh',
  ])
    if (!absent(file)) fail('host_or_unexpected_path_visible');
  const marker = path.join(control.root, '.minion-contained.json');
  if (digest(marker) !== control.markerSha256 || digest('/qc/worker.mjs') !== control.workerSha256)
    fail('probe_identity_mismatch');
  readonly(marker);
  readonly('/unexpected-root-write', true);
  for (const file of control.runtime.files)
    if (digest(file.logical) !== file.sha256) fail('runtime_hash_mismatch');
  const mounts = readFileSync('/proc/self/mountinfo', 'utf8')
    .trim()
    .split('\n')
    .map((line) => {
      const fields = line.split(' ');
      return { path: fields[4].replace(/\\040/g, ' '), options: fields[5].split(',') };
    });
  const allowed = new Set([
    '/',
    '/proc',
    '/dev',
    '/dev/pts',
    '/dev/shm',
    '/dev/null',
    '/dev/zero',
    '/dev/full',
    '/dev/random',
    '/dev/urandom',
    '/dev/tty',
    '/evidence',
    '/qc/worker.mjs',
    '/qc/control.json',
    control.root,
    ...(control.mode === 'decode' ? ['/qc/profile.log'] : []),
    ...control.runtime.files.map((file) => file.logical),
  ]);
  for (const mount of mounts) if (!allowed.has(mount.path)) fail('unexpected_mount');
  for (const file of [
    control.root,
    '/qc/worker.mjs',
    '/qc/control.json',
    ...(control.mode === 'decode' ? ['/qc/profile.log'] : []),
    ...control.runtime.files.map((file) => file.logical),
  ])
    if (!mounts.some((mount) => mount.path === file && mount.options.includes('ro')))
      fail('missing_readonly_mount');
  if (control.mode === 'decode') {
    const input = lstatSync('/qc/profile.log');
    if (
      !input.isFile() ||
      input.isSymbolicLink() ||
      input.size !== control.profileInput.bytes ||
      digest('/qc/profile.log') !== control.profileInput.sha256
    )
      fail('profile_identity_mismatch');
    readonly('/qc/profile.log');
  }
  const descriptors = [];
  for (const fd of readdirSync('/proc/self/fd')) {
    try {
      const target = readlinkSync('/proc/self/fd/' + fd);
      descriptors.push(target);
      if (target.startsWith('/') && !['/dev/null'].includes(target) && !target.startsWith('/proc/'))
        fail('unexpected_inherited_file_descriptor');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const network = await new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port: control.port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('network_probe_timeout'));
    }, 700);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      reject(new Error('host_listener_reachable'));
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      socket.destroy();
      if (!['ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH'].includes(error.code)) reject(error);
      else resolve(error.code);
    });
  });
  const proof = {
    event: 'isolation-ready',
    nonce: control.nonce,
    namespaces,
    mounts,
    network,
    descriptors,
    rootReadonly: true,
    artifactReadonly: true,
    absentProbes: true,
    zeroCapabilities: true,
    noNewPrivileges: true,
  };
  announce(proof);
  const lines = createInterface({ input: process.stdin });
  const admitted = await new Promise((resolve, reject) => {
    lines.once('line', (line) => {
      try {
        resolve(JSON.parse(line));
      } catch {
        reject(new Error('invalid_parent_admission'));
      }
    });
    lines.once('close', () => reject(new Error('parent_admission_closed')));
  });
  lines.close();
  if (admitted.admit !== control.nonce) fail('parent_admission_mismatch');
  write('isolation.json', proof);
}
async function trace() {
  const require = createRequire(path.join(control.root, 'package.json'));
  const engine = require.resolve('@vercel/nft');
  if (!engine.startsWith(control.root + '/')) fail('nft_outside_artifact');
  announce({ event: 'nft-loaded' });
  const { nodeFileTrace, resolve: resolveDependency } = require(engine);
  const { CachedFileSystem } = require(path.join(path.dirname(engine), 'fs.js'));
  const fs = new CachedFileSystem({ fileIOConcurrency: 1024 });
  let reads = 0,
    bytes = 0;
  const category = (file) =>
    file.startsWith(control.root + '/')
      ? { category: 'artifact', path: path.relative(control.root, file) }
      : control.runtime.files.some((item) => item.logical === file)
        ? { category: 'runtime', path: file }
        : { category: 'isolated-support', path: file };
  const event = (item) =>
    write('events.jsonl', { elapsedMs: Math.round(performance.now() - started), ...item }, true);
  announce({ event: 'entry-analysis-start' });
  const result = await nodeFileTrace([path.join(control.root, control.entry)], {
    base: '/',
    processCwd: '/',
    fileIOConcurrency: 1024,
    async readFile(file) {
      const value = await fs.readFile(file);
      if (value !== null) {
        reads++;
        bytes += Buffer.byteLength(value);
        event({ event: 'read', ...category(file), bytes: Buffer.byteLength(value) });
      }
      return value;
    },
    async stat(file) {
      const value = await fs.stat(file);
      if (value === null && ['/__data.json', '/minion/setup/setup.sh'].includes(file))
        event({ event: 'ordinary-absent-stat', path: file });
      return value;
    },
    readlink: (file) => fs.readlink(file),
    async resolve(id, parent, job, isCjs) {
      event({ event: 'resolve', parent: category(parent), specifier: id });
      return resolveDependency(id, parent, job, isCjs);
    },
  });
  const files = [...result.fileList].map((file) => {
    const absolute = path.resolve('/', file),
      info = category(absolute),
      stat = statSync(absolute);
    const reason = result.reasons.get(file);
    return {
      ...info,
      bytes: stat.size,
      sha256: stat.isFile() ? digest(absolute) : null,
      type: reason?.type,
      parents: [...(reason?.parents ?? [])].map((parent) => category(path.resolve('/', parent))),
    };
  });
  const unsupported = files.some((file) => file.category !== 'artifact');
  write('trace.json', {
    status: result.warnings.size || unsupported ? 'incomplete' : 'complete',
    files,
    warningCount: result.warnings.size,
    warnings: [...result.warnings].map((warning) => warning.message).sort(),
    unsupportedSupportAssets: unsupported,
    readCount: reads,
    readBytes: bytes,
    elapsedMs: Math.round(performance.now() - started),
    usage: process.resourceUsage(),
    nftVersion: require('@vercel/nft/package.json').version,
    options: { base: '/', processCwd: '/', fileIOConcurrency: 1024 },
  });
}
function minionProfileSyntheticHotLoop(durationMs) {
  const deadline = performance.now() + durationMs;
  let value = 1;
  while (performance.now() < deadline) {
    for (let n = 0; n < 10000; n++) value = Math.imul(value ^ n, 1664525) + 1013904223;
  }
  return value;
}
async function decode() {
  const raw = readFileSync('/qc/profile.log');
  const length = raw.lastIndexOf(10) + 1;
  const complete = raw.subarray(0, length);
  const text = complete.toString('utf8');
  const records = {
    ticks: (text.match(/^tick,/gm) ?? []).length,
    code: (text.match(/^code-creation,/gm) ?? []).length,
  };
  const identity = {
    originalBytes: raw.length,
    originalSha256: hash(raw),
    completeBytes: length,
    completeSha256: hash(complete),
    discardedTailBytes: raw.length - length,
    records,
  };
  write('profile-input.json', identity);
  if (!records.ticks || !records.code) {
    write('trace.json', { status: 'profile_unusable', ...identity });
    return;
  }
  // Only the exact newline-complete prefix is decoded; the raw mounted input is never rewritten.
  writeFileSync('/evidence/profile-complete.log', complete);
  const args = [
    `--max-old-space-size=${control.heapMiB}`,
    '--prof-process',
    '/evidence/profile-complete.log',
  ];
  announce({ event: 'decode-start', args });
  const child = spawn('/usr/bin/node', args, { env: {}, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdoutBytes = 0,
    stderrBytes = 0,
    exceeded = false,
    failure;
  const capture = (stream, file, limit, kind) =>
    stream.on('data', (data) => {
      const previous = kind === 'stdout' ? stdoutBytes : stderrBytes;
      const retained = data.subarray(0, Math.max(0, limit - previous));
      try {
        appendFileSync('/evidence/' + file, retained);
      } catch (error) {
        failure = error.message;
        child.kill('SIGKILL');
      }
      if (kind === 'stdout') stdoutBytes += retained.length;
      else stderrBytes += retained.length;
      if (data.length > retained.length) {
        exceeded = true;
        child.kill('SIGKILL');
      }
    });
  writeFileSync('/evidence/profile-decoded.txt', '');
  writeFileSync('/evidence/profile-decoder-stderr.txt', '');
  capture(child.stdout, 'profile-decoded.txt', control.decodeBytes, 'stdout');
  capture(child.stderr, 'profile-decoder-stderr.txt', 65536, 'stderr');
  child.stdout.on('error', (error) => {
    failure = error.message;
    child.kill('SIGKILL');
  });
  child.stderr.on('error', (error) => {
    failure = error.message;
    child.kill('SIGKILL');
  });
  const exit = await new Promise((resolve) => {
    child.once('error', (error) => {
      failure = error.message;
    });
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  // The built-in decoder can exit zero for malformed records; process success is not useful attribution.
  const decoded = readFileSync('/evidence/profile-decoded.txt', 'utf8');
  const diagnostics = readFileSync('/evidence/profile-decoder-stderr.txt', 'utf8');
  const counts = decoded.match(/\((\d+) ticks, (\d+) unaccounted, (\d+) excluded\)/);
  const summary = counts
    ? { ticks: Number(counts[1]), unaccounted: Number(counts[2]), excluded: Number(counts[3]) }
    : null;
  const malformed = /Unable to read v8-version|Log line contains unsafe integers|Error:/i.test(
    decoded + diagnostics,
  );
  const useful = summary && summary.ticks > summary.unaccounted && !malformed;
  write('trace.json', {
    status: exceeded
      ? 'decode_budget_exhausted'
      : failure || exit.code !== 0
        ? 'decode_failed'
        : useful
          ? 'decode_complete'
          : 'profile_unusable',
    decodedSummary: summary,
    malformedRecords: malformed,
    ...identity,
    exit,
    stdoutBytes,
    stderrBytes,
    failure,
    args,
  });
}

try {
  await isolation();
  if (control.mode === 'probe') write('trace.json', { status: 'probe_complete' });
  else if (control.mode === 'decode') await decode();
  else if (control.mode === 'profile-control-overflow-probe') {
    announce({ event: 'synthetic-control-overflow', detail: 'é'.repeat(40000) });
    setInterval(() => {}, 1000);
  } else if (control.mode === 'profile-hot-probe') {
    announce({ event: 'synthetic-workload-start' });
    const value = minionProfileSyntheticHotLoop(120000);
    write('trace.json', { status: 'probe_complete', value });
  } else if (['cleanup-probe', 'profile-cleanup-probe'].includes(control.mode)) {
    process.on('SIGTERM', () => {});
    const child = spawn(
      process.execPath,
      ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
      { detached: true, stdio: 'ignore', env: {} },
    );
    announce({ event: 'cleanup-descendant', pid: child.pid });
    setInterval(() => {}, 1000);
  } else await trace();
} catch (error) {
  try {
    write('trace.json', {
      status: 'error',
      code: error.message,
      elapsedMs: Math.round(performance.now() - started),
    });
  } catch {}
  console.error(JSON.stringify({ event: 'worker-failed', code: error.message }));
  process.exitCode = 2;
}
