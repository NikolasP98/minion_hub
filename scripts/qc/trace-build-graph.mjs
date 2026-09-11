// TODO(handoff): This diagnostic does not repair packaging or qualify deployment; route evidence to 12-05 results and meta proposals/2026-09-08-platform-qc-remediation.md before admitting a build change.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARKER = '.minion-trace-marker.json';
const SCRIPT = fileURLToPath(import.meta.url);
const SHA = /^[a-f0-9]{64}$/;
const inside = (root, value) => {
  const relative = path.relative(root, value);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
  );
};
export const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const fail = (code) => {
  throw new Error(code);
};

function relativeFile(root, name) {
  if (
    typeof name !== 'string' ||
    !name ||
    path.isAbsolute(name) ||
    name.split(/[\\/]/).includes('..')
  )
    fail('invalid_relative_path');
  const result = path.resolve(root, name);
  if (!inside(root, result)) fail('outside_artifact_root');
  return result;
}

export function validateManifest(manifestPath) {
  const manifestFile = path.resolve(manifestPath);
  if (
    realpathSync(manifestFile) !== manifestFile ||
    !inside(realpathSync(tmpdir()), manifestFile) ||
    statSync(manifestFile).size > 65_536
  )
    fail('invalid_manifest_location');
  const input = JSON.parse(readFileSync(manifestFile, 'utf8'));
  if (input.version !== 1 || typeof input.root !== 'string' || !path.isAbsolute(input.root))
    fail('invalid_manifest');
  const root = realpathSync(input.root);
  if (
    root !== input.root ||
    !inside(realpathSync(tmpdir()), root) ||
    root === realpathSync(tmpdir()) ||
    existsSync(path.join(root, '.git'))
  )
    fail('not_disposable_root');
  if (!path.basename(root).startsWith('minion-') && !root.includes('/minion-360-'))
    fail('not_marked_namespace');
  if (!inside(root, manifestFile)) fail('manifest_outside_artifact');
  const markerFile = path.join(root, MARKER);
  if (!lstatSync(markerFile).isFile() || lstatSync(markerFile).isSymbolicLink())
    fail('invalid_marker');
  const marker = JSON.parse(readFileSync(markerFile, 'utf8'));
  if (
    typeof input.id !== 'string' ||
    input.id.length < 16 ||
    marker.version !== 1 ||
    marker.id !== input.id
  )
    fail('marker_identity_mismatch');
  const entry = relativeFile(root, input.entry);
  const output = relativeFile(root, input.output);
  if (!input.output.startsWith('trace-results/')) fail('invalid_output_namespace');
  if (
    !Number.isInteger(input.timeoutMs) ||
    input.timeoutMs < 1 ||
    input.timeoutMs > 60_000 ||
    !Number.isInteger(input.heapMiB) ||
    input.heapMiB < 128 ||
    input.heapMiB > 2048
  )
    fail('invalid_resource_budget');
  if (
    input.fileIOConcurrency !== undefined &&
    (!Number.isInteger(input.fileIOConcurrency) ||
      input.fileIOConcurrency < 1 ||
      input.fileIOConcurrency > 1024)
  )
    fail('invalid_io_budget');
  if (!input.hashes || typeof input.hashes !== 'object') fail('missing_hashes');
  for (const required of [
    'package.json',
    'bun.lock',
    input.entry,
    'node_modules/@vercel/nft/package.json',
    'node_modules/@vercel/nft/out/index.js',
    'node_modules/@vercel/nft/out/fs.js',
  ]) {
    if (!SHA.test(input.hashes[required] ?? '')) fail('missing_required_hash');
  }
  // Scan before hashing/reading any symlink target. This also guards nft's own glob implementation.
  const visit = (directory) => {
    for (const name of readdirSync(directory)) {
      const file = path.join(directory, name);
      const metadata = lstatSync(file);
      if (metadata.isSymbolicLink()) {
        if (!inside(root, realpathSync(file))) fail('symlink_escape');
      } else if (metadata.isDirectory()) visit(file);
    }
  };
  visit(root);
  for (const name of readdirSync(root).filter((name) => name.startsWith('.env'))) {
    const file = path.join(root, name);
    if (!statSync(file).isFile() || statSync(file).size > 4096) fail('private_environment_file');
    const lines = readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim());
    if (lines.some((line) => !/^PUBLIC_POSTHOG_(KEY|HOST)\s*=\s*$/.test(line)))
      fail('private_environment_binding');
  }
  for (const [name, hash] of Object.entries(input.hashes)) {
    const file = relativeFile(root, name);
    if (!SHA.test(hash) || !statSync(file).isFile() || digest(file) !== hash)
      fail('artifact_hash_mismatch');
  }
  if (!statSync(entry).isFile()) fail('missing_entry');
  if (existsSync(output) && (!statSync(output).isDirectory() || readdirSync(output).length))
    fail('output_not_empty');
  return { ...input, root, entry, output };
}

/** Parent-enforced process-group cleanup; exported for the synthetic stuck-child fixture. */
export async function runBoundedChild(args, { cwd, timeoutMs, environment = {} }) {
  const started = performance.now();
  const env = Object.fromEntries(
    ['PATH', 'LANG', 'TMPDIR']
      .filter((name) => process.env[name])
      .map((name) => [name, process.env[name]]),
  );
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...env, ...environment },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '',
    stderr = '',
    timedOut = false,
    peakRssKiB = 0,
    force;
  const append = (current, chunk) => (current + String(chunk)).slice(-65_536);
  child.stdout.on('data', (chunk) => {
    stdout = append(stdout, chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderr = append(stderr, chunk);
  });
  const kill = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  const sample = setInterval(() => {
    try {
      peakRssKiB = Math.max(
        peakRssKiB,
        Number(
          readFileSync(`/proc/${child.pid}/status`, 'utf8').match(/^VmHWM:\s+(\d+)/m)?.[1] ?? 0,
        ),
      );
    } catch {
      /* child has exited */
    }
  }, 100);
  const timeout = setTimeout(() => {
    timedOut = true;
    kill('SIGTERM');
    force = setTimeout(() => kill('SIGKILL'), 500);
  }, timeoutMs);
  try {
    const exit = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    return {
      ...exit,
      pid: child.pid,
      timedOut,
      peakRssKiB,
      elapsedMs: Math.round(performance.now() - started),
      stdout,
      stderr,
    };
  } finally {
    clearTimeout(timeout);
    clearTimeout(force);
    clearInterval(sample);
  }
}

async function traceWorker(manifestPath) {
  const input = validateManifest(manifestPath);
  const { root, output } = input;
  const require = createRequire(path.join(root, 'package.json'));
  const engine = require.resolve('@vercel/nft');
  if (!inside(root, realpathSync(engine))) fail('engine_outside_artifact');
  const { nodeFileTrace, resolve: resolveDependency } = require(engine);
  // Preserve this exact installed nft version's IO cache/limiter under observation.
  // This internal class is hash-pinned in the diagnostic manifest, never patched.
  const { CachedFileSystem } = require(path.join(path.dirname(engine), 'fs.js'));
  const observedFs = new CachedFileSystem({ fileIOConcurrency: input.fileIOConcurrency ?? 1024 });
  const journal = path.join(output, 'events.jsonl');
  const started = performance.now();
  let readBytes = 0,
    readCount = 0,
    blocked = false;
  const record = (event) =>
    appendFileSync(
      journal,
      JSON.stringify({ elapsedMs: Math.round(performance.now() - started), ...event }) + '\n',
    );
  const guarded = (file, operation) => {
    const absolute = path.resolve(file);
    if (!inside(root, absolute)) {
      blocked = true;
      const boundary = {
        operation,
        outsidePathSha256: createHash('sha256').update(absolute).digest('hex'),
      };
      record({ event: 'blocked', ...boundary });
      // nft may catch a hook error as an optional-asset miss. Terminate this
      // isolated diagnostic immediately instead of letting analysis continue.
      writeFileSync(
        path.join(output, 'trace.json'),
        JSON.stringify(
          {
            status: 'blocked',
            boundary,
            readCount,
            readBytes,
            elapsedMs: Math.round(performance.now() - started),
            usage: process.resourceUsage(),
            inputHashes: input.hashes,
            harnessSha256: digest(SCRIPT),
            manifestSha256: digest(manifestPath),
          },
          null,
          2,
        ),
      );
      process.exit(2);
    }
    return absolute;
  };
  const options = {
    base: path.parse(root).root,
    processCwd: path.parse(root).root,
    fileIOConcurrency: input.fileIOConcurrency ?? 1024,
    ignore(relative) {
      const file = path.resolve(path.parse(root).root, relative);
      if (!inside(root, file)) {
        guarded(file, 'glob_or_emit');
        return true;
      }
      if (/[*?{[]/.test(relative)) record({ event: 'glob', path: path.relative(root, file) });
      return false;
    },
    async readFile(file) {
      const safe = guarded(file, 'read');
      try {
        const value = await observedFs.readFile(safe);
        if (value === null) return null;
        readCount++;
        readBytes += Buffer.byteLength(value);
        record({ event: 'read', path: path.relative(root, safe), bytes: Buffer.byteLength(value) });
        return value;
      } catch (error) {
        if (['ENOENT', 'EISDIR'].includes(error.code)) return null;
        throw error;
      }
    },
    async stat(file) {
      // nft asks about ancestor directory metadata while resolving realpaths; permit metadata only.
      const absolute = path.resolve(file);
      if (!inside(root, absolute) && !inside(absolute, root)) guarded(absolute, 'stat');
      try {
        return await observedFs.stat(absolute);
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
        throw error;
      }
    },
    async readlink(file) {
      const absolute = path.resolve(file);
      if (!inside(root, absolute) && !inside(absolute, root)) guarded(absolute, 'readlink');
      try {
        return await observedFs.readlink(absolute);
      } catch (error) {
        if (['ENOENT', 'EINVAL', 'ENOTDIR'].includes(error.code)) return null;
        throw error;
      }
    },
    async resolve(id, parent, job, isCjs) {
      guarded(parent, 'resolve_parent');
      record({
        event: 'resolve',
        parent: path.relative(root, parent),
        specifier: path.isAbsolute(id)
          ? '<absolute:' + createHash('sha256').update(id).digest('hex') + '>'
          : id,
      });
      const found = await resolveDependency(id, parent, job, isCjs);
      for (const file of Array.isArray(found) ? found : [found])
        if (!file.startsWith('node:')) guarded(file, 'resolved');
      return found;
    },
  };
  let result;
  try {
    const traced = await nodeFileTrace([input.entry], options);
    const files = [...traced.fileList].map((file) =>
      guarded(path.resolve(options.base, file), 'result'),
    );
    result = {
      status: blocked ? 'blocked' : traced.warnings.size ? 'incomplete' : 'complete',
      files: files.map((file) => path.relative(root, file)),
      fileBytes: files.reduce((total, file) => total + statSync(file).size, 0),
      reasons: files.map((file) => {
        const reason = traced.reasons.get(path.relative(options.base, file));
        return {
          path: path.relative(root, file),
          type: reason?.type,
          parents: [...(reason?.parents ?? [])].map((parent) =>
            path.relative(root, guarded(path.resolve(options.base, parent), 'reason')),
          ),
        };
      }),
      warningCount: traced.warnings.size,
    };
  } catch (error) {
    result = { status: blocked ? 'blocked' : 'error', errorName: error.name };
  }
  result = {
    ...result,
    readCount,
    readBytes,
    elapsedMs: Math.round(performance.now() - started),
    usage: process.resourceUsage(),
    inputHashes: input.hashes,
    harnessSha256: digest(SCRIPT),
    manifestSha256: digest(manifestPath),
    traceOptions: {
      base: 'filesystem-root',
      processCwd: 'filesystem-root',
      fileIOConcurrency: input.fileIOConcurrency ?? 1024,
    },
    nftVersion: require('@vercel/nft/package.json').version,
  };
  writeFileSync(path.join(output, 'trace.json'), JSON.stringify(result, null, 2));
  process.exitCode = result.status === 'complete' ? 0 : 2;
}

export async function runManifest(manifestPath) {
  const input = validateManifest(manifestPath);
  mkdirSync(input.output, { recursive: true });
  const execution = await runBoundedChild(
    [`--max-old-space-size=${input.heapMiB}`, SCRIPT, '--worker', path.resolve(manifestPath)],
    { cwd: input.root, timeoutMs: input.timeoutMs },
  );
  const resultPath = path.join(input.output, 'trace.json');
  const trace = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, 'utf8')) : undefined;
  const result = {
    status: execution.timedOut
      ? 'timeout'
      : execution.code === 0 && trace?.status === 'complete'
        ? 'complete'
        : (trace?.status ?? 'child_failure'),
    execution,
    trace,
  };
  writeFileSync(path.join(input.output, 'process.json'), JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT) {
  const [mode, manifest] = process.argv.slice(2);
  try {
    if (!manifest || !['--manifest', '--worker'].includes(mode)) fail('explicit_manifest_required');
    if (mode === '--worker') await traceWorker(manifest);
    else {
      const result = await runManifest(manifest);
      console.log(
        JSON.stringify({
          status: result.status,
          elapsedMs: result.execution.elapsedMs,
          peakRssKiB: result.execution.peakRssKiB,
        }),
      );
      process.exitCode = result.status === 'complete' ? 0 : 2;
    }
  } catch (error) {
    console.error(
      error.code ?? (/^[a-z_]+$/.test(error.message) ? error.message : 'invalid_trace_input'),
    );
    process.exitCode = 2;
  }
}
