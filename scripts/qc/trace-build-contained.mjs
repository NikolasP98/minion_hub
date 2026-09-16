// TODO(handoff): Contained tracing is diagnostic only; root must review isolation before application runs and retain the packaging/asset gaps in meta proposals/2026-09-08-platform-qc-remediation.md.
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const MARKER = '.minion-contained.json';
const SELF = fileURLToPath(import.meta.url);
const WORKER = fileURLToPath(new URL('./trace-build-contained-worker.mjs', import.meta.url));
const NODE = '/usr/bin/node',
  BWRAP = '/usr/bin/bwrap';
const PROFILE_MAX = 16 * 1024 * 1024;
const DECODE_MAX = 4 * 1024 * 1024;
const profileMode = (mode) =>
  [
    'profile',
    'profile-hot-probe',
    'profile-control-overflow-probe',
    'profile-cleanup-probe',
  ].includes(mode);
const PROFILE_FLAGS = [
  '--prof',
  '--prof-sampling-interval=1000',
  '--logfile=-',
  '--no-logfile-per-isolate',
];
const namespaces = ['user', 'pid', 'net', 'ipc', 'uts', 'mnt'];
const hash = (value) => createHash('sha256').update(value).digest('hex');
export const digest = (file) => hash(readFileSync(file));
const fail = (code) => {
  throw new Error(code);
};
const inside = (root, file) => file === root || file.startsWith(root + path.sep);
function regular(file) {
  const s = lstatSync(file);
  if (!s.isFile() || s.isSymbolicLink()) fail('expected_regular_file');
  return s;
}
function temporary(directory) {
  const root = realpathSync(directory);
  if (
    root !== directory ||
    !inside(realpathSync(tmpdir()), root) ||
    root === realpathSync(tmpdir()) ||
    !root.includes('/minion-') ||
    existsSync(path.join(root, '.git')) ||
    statSync(root).uid !== process.getuid()
  )
    fail('not_owned_temporary_root');
  return root;
}
function relative(root, name) {
  if (
    typeof name !== 'string' ||
    !name ||
    path.isAbsolute(name) ||
    name.split(/[\\/]/).includes('..')
  )
    fail('invalid_relative_path');
  const file = path.resolve(root, name);
  if (!inside(root, file)) fail('path_escape');
  return file;
}
function json(file, limit = 1024 * 1024) {
  if (regular(file).size > limit) fail('oversized_json');
  return JSON.parse(readFileSync(file, 'utf8'));
}
export function inventory(root) {
  temporary(root);
  const files = [];
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      const file = path.join(directory, name),
        s = lstatSync(file),
        logical = path.relative(root, file);
      if (name === '.git') fail('nested_checkout');
      if (s.isSymbolicLink()) {
        const target = realpathSync(file);
        if (!inside(root, target)) fail('symlink_escape');
        if (name.startsWith('.env')) fail('environment_symlink');
        files.push({ path: logical, link: readlinkSync(file) });
      } else if (s.isDirectory()) {
        files.push({ path: logical, directory: true });
        visit(file);
      } else if (s.isFile()) {
        if (logical === 'node_modules/bottleneck/.env') {
          // Exact public defaults classified in 12-BUILD-CONTAINMENT-RESULTS;
          // keep the file in the inventory and mount, never suppress nft assets.
          const metadata = path.join(root, 'node_modules/bottleneck/package.json');
          regular(metadata);
          if (
            s.size !== 37 ||
            digest(file) !== '9a71de52ef575866ca37dce0fe306c2571ed84f780ae2e8a263a6135fc42ac74' ||
            digest(metadata) !== '9e73efe094fc7802ce2288f1e342e9f28c2fe75f017002a96a35a478eb1df4d9'
          )
            fail('public_vendor_default_identity_mismatch');
        } else if (name.startsWith('.env')) {
          if (
            s.size > 4096 ||
            readFileSync(file, 'utf8')
              .split(/\r?\n/)
              .some((line) => line.trim() && !/^PUBLIC_POSTHOG_(KEY|HOST)\s*=\s*$/.test(line))
          )
            fail('private_environment_file');
        }
        files.push({ path: logical, bytes: s.size, sha256: digest(file) });
      } else fail('special_artifact_file');
    }
  }
  visit(root);
  const encoded = JSON.stringify(files);
  if (Buffer.byteLength(encoded) > 32 * 1024 * 1024) fail('inventory_evidence_budget');
  return { sha256: hash(encoded), files };
}
function trustedCommand(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 1024 * 1024,
    env: { PATH: '/usr/bin', LANG: 'C' },
  });
  if (result.error || result.status !== 0) fail('runtime_discovery_failed');
  return result.stdout;
}
export function discoverRuntime() {
  for (const file of [NODE, BWRAP]) {
    const s = regular(file);
    if (s.uid !== 0 || s.mode & 0o6022) fail('untrusted_runtime');
  }
  const help = trustedCommand(BWRAP, ['--help']);
  for (const flag of [
    '--unshare-user',
    '--unshare-net',
    '--disable-userns',
    '--assert-userns-disabled',
    '--json-status-fd',
    '--die-with-parent',
    '--new-session',
    '--clearenv',
  ])
    if (!help.includes(flag)) fail('mandatory_namespace_control_missing');
  const elf = trustedCommand('/usr/bin/readelf', ['-l', NODE]);
  const interpreter = elf.match(/Requesting program interpreter: (\/[^\]]+)\]/)?.[1];
  if (!interpreter) fail('missing_interpreter');
  const linked = trustedCommand('/usr/bin/ldd', [NODE]);
  if (linked.includes('not found')) fail('unresolved_runtime_library');
  const logicalPaths = [
    ...new Set([NODE, interpreter, ...[...linked.matchAll(/(?:=>\s+)?(\/\S+)/g)].map((m) => m[1])]),
  ].sort();
  const files = logicalPaths.map((logical) => {
    if (!/^\/(usr\/)?lib(64)?\/[A-Za-z0-9_./+-]+$/.test(logical) && logical !== NODE)
      fail('unexpected_runtime_path');
    const source = realpathSync(logical),
      s = regular(source);
    if (s.uid !== 0 || s.mode & 0o6022) fail('untrusted_runtime_library');
    return { source, logical, sha256: digest(source) };
  });
  return {
    node: NODE,
    nodeVersion: trustedCommand(NODE, ['--version']).trim(),
    bwrap: BWRAP,
    bwrapVersion: trustedCommand(BWRAP, ['--version']).trim(),
    bwrapSha256: digest(BWRAP),
    files,
  };
}
export function createManifest(root, run, entry, options = {}) {
  const preparationStarted = performance.now();
  temporary(root);
  temporary(run);
  if (inside(root, run) || inside(run, root) || readdirSync(run).length)
    fail('run_not_fresh_or_overlapping');
  if (
    Object.keys(options).some(
      (key) =>
        ![
          'mode',
          'timeoutMs',
          'heapMiB',
          'outputBytes',
          'profileBytes',
          'decodeBytes',
          'profileFile',
        ].includes(key),
    )
  )
    fail('unexpected_manifest_option');
  const id = json(path.join(root, MARKER)).id;
  if (!/^[a-f0-9-]{36}$/.test(id)) fail('bad_marker');
  writeFileSync(path.join(run, MARKER), JSON.stringify({ version: 1, id }));
  const { profileFile, ...settings } = options;
  let profileInput;
  if (profileFile !== undefined) {
    if (options.mode !== 'decode') fail('profile_input_mode');
    const sourceRun = path.dirname(path.dirname(profileFile));
    temporary(sourceRun);
    if (
      profileFile !== path.join(sourceRun, 'evidence', 'profile.v8.log') ||
      realpathSync(profileFile) !== profileFile
    )
      fail('invalid_profile_source');
    if (json(path.join(sourceRun, MARKER)).id !== id) fail('profile_marker_mismatch');
    const bytes = regular(profileFile).size;
    if (bytes > PROFILE_MAX) fail('oversized_profile_input');
    const destination = path.join(run, 'profile-input.log');
    writeFileSync(destination, readFileSync(profileFile), { flag: 'wx' });
    profileInput = { file: destination, bytes, sha256: digest(destination) };
  }
  const input = {
    version: 1,
    id,
    root,
    run,
    entry,
    mode: 'trace',
    timeoutMs: 10000,
    heapMiB: 512,
    outputBytes: 8 * 1024 * 1024,
    ...settings,
    ...(profileInput ? { profileInput } : {}),
    artifactSha256: inventory(root).sha256,
    runtime: discoverRuntime(),
    launcherSha256: digest(SELF),
    workerSha256: digest(WORKER),
    inputHashes: Object.fromEntries(
      ['package.json', 'bun.lock', entry].map((file) => [file, digest(relative(root, file))]),
    ),
  };
  input.preparationMs = Math.round(performance.now() - preparationStarted);
  const file = path.join(run, 'input.json');
  writeFileSync(file, JSON.stringify(input, null, 2));
  return file;
}
export function validateManifest(file) {
  if (realpathSync(file) !== file) fail('manifest_symlink');
  temporary(path.dirname(file));
  const input = json(file);
  const allowed = [
    'version',
    'id',
    'root',
    'run',
    'entry',
    'mode',
    'timeoutMs',
    'heapMiB',
    'outputBytes',
    'artifactSha256',
    'runtime',
    'launcherSha256',
    'workerSha256',
    'inputHashes',
    'preparationMs',
    'profileBytes',
    'decodeBytes',
    'profileInput',
  ];
  if (Object.keys(input).some((key) => !allowed.includes(key)) || input.version !== 1)
    fail('unexpected_manifest_field');
  temporary(input.root);
  temporary(input.run);
  if (!inside(input.run, file) || inside(input.root, input.run) || inside(input.run, input.root))
    fail('overlapping_roots');
  for (const directory of [input.root, input.run]) {
    const marker = json(path.join(directory, MARKER));
    if (marker.version !== 1 || marker.id !== input.id || !/^[a-f0-9-]{36}$/.test(input.id))
      fail('marker_mismatch');
  }
  if (
    ![
      'probe',
      'trace',
      'cleanup-probe',
      'profile',
      'profile-hot-probe',
      'profile-control-overflow-probe',
      'profile-cleanup-probe',
      'decode',
    ].includes(input.mode) ||
    !Number.isInteger(input.timeoutMs) ||
    input.timeoutMs < 200 ||
    input.timeoutMs > 60000 ||
    !Number.isInteger(input.heapMiB) ||
    input.heapMiB < 128 ||
    input.heapMiB > 2048 ||
    !Number.isInteger(input.outputBytes) ||
    input.outputBytes < 1024 ||
    input.outputBytes > 32 * 1024 * 1024
  )
    fail('invalid_budget_or_mode');
  const profiling = profileMode(input.mode);
  for (const [key, active, maximum] of [
    ['profileBytes', profiling, PROFILE_MAX],
    ['decodeBytes', input.mode === 'decode', DECODE_MAX],
  ]) {
    if (
      input[key] !== undefined &&
      (!active || !Number.isInteger(input[key]) || input[key] < 1024 || input[key] > maximum)
    )
      fail('invalid_profile_budget');
  }
  if ((profiling || input.mode === 'decode') && input.outputBytes > 8 * 1024 * 1024)
    fail('invalid_worker_budget');
  if (input.mode === 'decode') {
    const item = input.profileInput;
    if (
      !item ||
      Object.keys(item).sort().join(',') !== 'bytes,file,sha256' ||
      item.file !== path.join(input.run, 'profile-input.log') ||
      realpathSync(item.file) !== item.file
    )
      fail('invalid_profile_input');
    if (
      regular(item.file).size > PROFILE_MAX ||
      regular(item.file).size !== item.bytes ||
      digest(item.file) !== item.sha256
    )
      fail('profile_identity_mismatch');
  } else if (input.profileInput !== undefined) fail('profile_input_mode');
  if (input.launcherSha256 !== digest(SELF) || input.workerSha256 !== digest(WORKER))
    fail('harness_hash_mismatch');
  if (JSON.stringify(input.runtime) !== JSON.stringify(discoverRuntime()))
    fail('runtime_identity_mismatch');
  const snapshot = inventory(input.root);
  if (snapshot.sha256 !== input.artifactSha256) fail('artifact_identity_mismatch');
  for (const name of ['package.json', 'bun.lock', input.entry])
    if (input.inputHashes?.[name] !== digest(relative(input.root, name)))
      fail('input_hash_mismatch');
  const output = path.join(input.run, 'evidence');
  if (existsSync(output)) fail('output_not_fresh');
  return { ...input, file, snapshot, output };
}
export function sandboxArgs(input, control) {
  const args = [
    '--unshare-all',
    '--unshare-user',
    '--unshare-net',
    '--unshare-pid',
    '--unshare-ipc',
    '--unshare-uts',
    '--disable-userns',
    '--assert-userns-disabled',
    '--cap-drop',
    'ALL',
    '--die-with-parent',
    '--new-session',
    '--clearenv',
    '--json-status-fd',
    '3',
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--dir',
    '/tmp',
    '--ro-bind',
    input.root,
    input.root,
  ];
  for (const file of input.runtime.files) args.push('--ro-bind', file.source, file.logical);
  if (input.mode === 'decode') args.push('--ro-bind', input.profileInput.file, '/qc/profile.log');
  args.push(
    '--ro-bind',
    WORKER,
    '/qc/worker.mjs',
    '--ro-bind',
    control,
    '/qc/control.json',
    '--bind',
    input.output,
    '/evidence',
    '--remount-ro',
    '/',
    '--chdir',
    '/',
    '--',
    NODE,
    `--max-old-space-size=${input.heapMiB}`,
    ...(profileMode(input.mode) ? PROFILE_FLAGS : []),
    '/qc/worker.mjs',
  );
  return args;
}

export async function runManifest(file) {
  const totalStarted = performance.now();
  const input = validateManifest(file);
  const preflightMs = Math.round(performance.now() - totalStarted);
  mkdirSync(input.output);
  const nonce = randomUUID();
  const sentinel = path.join(input.run, 'host-sentinel');
  writeFileSync(sentinel, nonce);
  const server = createServer((socket) => {
    connections++;
    socket.destroy();
  });
  let connections = 0;
  const control = {
    root: input.root,
    entry: input.entry,
    mode: input.mode,
    nonce,
    sentinel,
    markerSha256: digest(path.join(input.root, MARKER)),
    runtime: input.runtime,
    workerSha256: input.workerSha256,
    outputBytes: input.outputBytes,
    heapMiB: input.heapMiB,
    decodeBytes: input.decodeBytes ?? DECODE_MAX,
    ...(input.profileInput ? { profileInput: input.profileInput } : {}),
    parentNamespaces: Object.fromEntries(
      namespaces.map((name) => [name, readlinkSync(`/proc/self/ns/${name}`)]),
    ),
  };
  const profiling = profileMode(input.mode);
  const profileFile = path.join(input.output, 'profile.v8.log');
  const profile = profiling
    ? {
        receivedBytes: 0,
        persistedBytes: 0,
        discardedBytes: 0,
        firstReceiptMs: null,
        lastReceiptMs: null,
        ceilingBytes: input.profileBytes ?? PROFILE_MAX,
        budgetExceeded: false,
        writeFailed: false,
      }
    : undefined;
  if (profiling) writeFileSync(profileFile, '', { flag: 'wx' });
  let child,
    timer,
    force,
    probeTimer,
    sample,
    status = '',
    stdout = '',
    stderr = '',
    proof,
    hostPid,
    verified = false,
    timedOut = false,
    resourceExceeded = false,
    peakRssKiB = 0;
  const descendants = new Set();
  const observeChildren = (pid) => {
    try {
      const children = readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(Number);
      for (const childPid of children) {
        descendants.add(childPid);
        observeChildren(childPid);
      }
    } catch {}
  };
  const started = performance.now();
  const terminate = (signal = 'SIGTERM') => {
    if (child?.pid) {
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  };
  const stop = () => {
    terminate();
    force ??= setTimeout(() => terminate('SIGKILL'), 300);
  };
  const inspect = () => {
    if (!proof || !hostPid || verified) return;
    try {
      const parentObserved = Object.fromEntries(
        namespaces.map((name) => [name, readlinkSync(`/proc/${hostPid}/ns/${name}`)]),
      );
      for (const name of namespaces)
        if (
          parentObserved[name] !== proof.namespaces[name] ||
          parentObserved[name] === control.parentNamespaces[name]
        )
          fail('parent_namespace_mismatch');
      if (proof.nonce !== nonce || connections !== 0) fail('isolation_challenge_failed');
      const status = readFileSync(`/proc/${hostPid}/status`, 'utf8');
      if (!/^NoNewPrivs:\s+1$/m.test(status) || !/^CapEff:\s+0+$/m.test(status))
        fail('parent_privilege_check_failed');
      proof.parentPrivilegeChecks = { noNewPrivileges: true, zeroEffectiveCapabilities: true };
      proof.parentObserved = parentObserved;
      verified = true;
      clearTimeout(probeTimer);
      child.stdin.end(JSON.stringify({ admit: nonce }) + '\n');
    } catch {
      stop();
    }
  };
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    control.port = server.address().port;
    const controlFile = path.join(input.run, 'control.json');
    writeFileSync(controlFile, JSON.stringify(control));
    const args = sandboxArgs(input, controlFile);
    const childStarted = performance.now();
    child = spawn(BWRAP, args, {
      detached: true,
      env: {},
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    });
    child.stdin.on('error', () => {});
    child.stdio[3].on('data', (chunk) => {
      status += chunk;
      if (status.length > 65536) {
        resourceExceeded = true;
        stop();
        return;
      }
      for (const line of status.trim().split('\n')) {
        try {
          const item = JSON.parse(line);
          if (item['child-pid']) hostPid = item['child-pid'];
        } catch {}
      }
      inspect();
    });
    let profileControl = Buffer.alloc(0);
    const controlData = (chunk) => {
      if (profiling) {
        const available = 65536 - profileControl.length;
        profileControl = Buffer.concat([profileControl, chunk.subarray(0, available)]);
        stderr = profileControl.toString('utf8');
        // A truncated UTF-8 sequence can decode as a three-byte replacement character.
        while (Buffer.byteLength(stderr) > 65536) stderr = stderr.slice(0, -1);
        if (chunk.length > available) {
          resourceExceeded = true;
          profile.controlOverflow = true;
          stop();
          return;
        }
      } else stdout += chunk;
      const value = profiling ? stderr : stdout;
      if (!profiling && value.length > 65536) {
        stdout = stdout.slice(0, 65536);
        resourceExceeded = true;
        stop();
        return;
      }
      const complete = profiling ? value.slice(0, value.lastIndexOf('\n') + 1) : value;
      for (const line of complete.trim().split('\n')) {
        try {
          const item = JSON.parse(line);
          if (item.event === 'isolation-ready' && !proof) proof = item;
        } catch {}
      }
      inspect();
    };
    child.stdout.on('data', (chunk) => {
      if (!profiling) return controlData(chunk);
      profile.receivedBytes += chunk.length;
      profile.firstReceiptMs ??= Math.round(performance.now() - childStarted);
      // TODO(handoff): Establish coverage of messages analysis before attributing its timeout;
      // 12-07 captured no bytes after 3.570s of 60.025s and decoded mainly initialization.
      // See proposals/2026-09-08-platform-qc-remediation.md (partial CPU-profile coverage).
      profile.lastReceiptMs = Math.round(performance.now() - childStarted);
      const retained = chunk.subarray(
        0,
        Math.max(0, profile.ceilingBytes - profile.persistedBytes),
      );
      try {
        appendFileSync(profileFile, retained);
        profile.persistedBytes += retained.length;
      } catch {
        profile.writeFailed = true;
        stop();
      }
      profile.discardedBytes = profile.receivedBytes - profile.persistedBytes;
      if (profile.receivedBytes > profile.ceilingBytes) {
        profile.budgetExceeded = true;
        stop();
      }
    });
    child.stderr.on('data', (chunk) => {
      if (profiling) return controlData(chunk);
      stderr = (stderr + chunk).slice(-65536);
    });
    for (const stream of [child.stdout, child.stderr])
      stream.on('error', () => {
        resourceExceeded = true;
        stop();
      });
    timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, input.timeoutMs);
    probeTimer = setTimeout(
      () => {
        if (!verified) stop();
      },
      Math.min(5000, input.timeoutMs),
    );
    sample = setInterval(() => {
      observeChildren(child.pid);
      try {
        // TODO(handoff): Verify Node-worker lineage before using peakRssKiB for memory comparisons;
        // Bubblewrap child-pid is the reaper in the retained 12-06 runs. Auxiliary cmdline samples
        // also include Bubblewrap. See proposals/2026-09-08-platform-qc-remediation.md (contained trace RSS attribution).
        const pid = hostPid ?? child.pid;
        peakRssKiB = Math.max(
          peakRssKiB,
          Number(readFileSync(`/proc/${pid}/status`, 'utf8').match(/^VmHWM:\s+(\d+)/m)?.[1] ?? 0),
        );
      } catch {}
      try {
        const bytes = readdirSync(input.output).reduce(
          (n, name) => n + lstatSync(path.join(input.output, name)).size,
          0,
        );
        if (
          bytes >
          input.outputBytes +
            (profiling ? profile.ceilingBytes : 0) +
            (input.mode === 'decode'
              ? input.profileInput.bytes + (input.decodeBytes ?? DECODE_MAX) + 65536
              : 0)
        ) {
          resourceExceeded = true;
          stop();
        }
      } catch {
        stop();
      }
    }, 50);
    const exit = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    const childEnded = performance.now();
    clearTimeout(timer);
    clearTimeout(force);
    clearTimeout(probeTimer);
    clearInterval(sample);
    const after = inventory(input.root).sha256;
    const runtimeUnchanged =
      input.runtime.files.every((item) => digest(item.source) === item.sha256) &&
      digest(BWRAP) === input.runtime.bwrapSha256 &&
      digest(WORKER) === input.workerSha256;
    const profileInputUnchanged =
      !input.profileInput ||
      (regular(input.profileInput.file).size === input.profileInput.bytes &&
        digest(input.profileInput.file) === input.profileInput.sha256);
    if (profile) profile.sha256 = digest(profileFile);
    const workerResult = path.join(input.output, 'trace.json');
    const trace = existsSync(workerResult) ? json(workerResult, input.outputBytes) : undefined;
    const outcome =
      after !== input.artifactSha256 || !runtimeUnchanged || !profileInputUnchanged
        ? 'input_changed'
        : profile?.writeFailed
          ? 'profile-write-failed'
          : profile?.budgetExceeded
            ? 'profile-budget-exhausted'
            : resourceExceeded || exit.code === 3
              ? 'output_budget'
              : timedOut
                ? 'timeout'
                : !verified
                  ? 'isolation_failed'
                  : exit.code !== 0
                    ? 'child_failure'
                    : (trace?.status ?? 'missing_result');
    const result = {
      status: outcome,
      execution: {
        ...exit,
        elapsedMs: Math.round(childEnded - childStarted),
        peakRssKiB,
        timedOut,
        namespacePid: hostPid,
        observedDescendants: [...descendants],
        stdout,
        stderr,
      },
      timing: {
        manifestPreparationMs: input.preparationMs ?? null,
        preflightMs,
        namespaceSetupMs: Math.round(childStarted - started),
        childMs: Math.round(childEnded - childStarted),
        postflightMs: Math.round(performance.now() - childEnded),
        totalMs: Math.round(performance.now() - totalStarted),
      },
      proof,
      ...(profile ? { profile } : {}),
      listenerConnections: connections,
      trace,
      identities: {
        manifestSha256: digest(file),
        launcherSha256: digest(SELF),
        workerSha256: digest(WORKER),
        runtime: input.runtime,
        before: input.artifactSha256,
        after,
        runtimeUnchanged,
        ...(input.profileInput ? { profileInput: input.profileInput, profileInputUnchanged } : {}),
        inputHashes: input.inputHashes,
      },
      mountArguments: args.slice(0, args.indexOf('--')),
      executionArguments: args.slice(args.indexOf('--') + 1),
      artifactInventory: input.snapshot.files,
    };
    const encoded = JSON.stringify(result, null, 2);
    if (Buffer.byteLength(encoded) > 64 * 1024 * 1024) fail('parent_evidence_budget');
    writeFileSync(path.join(input.run, 'process.json'), encoded);
    return result;
  } finally {
    clearTimeout(timer);
    clearTimeout(force);
    clearTimeout(probeTimer);
    clearInterval(sample);
    // A private PID namespace is torn down on launcher death, including detached descendants.
    terminate('SIGKILL');
    await new Promise((resolve) => server.close(() => resolve()));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  try {
    if (process.argv[2] !== '--manifest' || !process.argv[3]) fail('explicit_manifest_required');
    const result = await runManifest(path.resolve(process.argv[3]));
    console.log(JSON.stringify({ status: result.status, elapsedMs: result.execution.elapsedMs }));
    process.exitCode = ['complete', 'probe_complete', 'decode_complete'].includes(result.status)
      ? 0
      : 2;
  } catch (error) {
    console.error(
      JSON.stringify({
        status: 'rejected',
        code: error.message,
        launcherSha256: digest(SELF),
        workerSha256: digest(WORKER),
      }),
    );
    process.exitCode = 2;
  }
}
