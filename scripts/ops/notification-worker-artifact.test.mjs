import assert from 'node:assert/strict';
import {
  chmod,
  chown,
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  symlink,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, test } from 'node:test';
import { sha256File, verifyArtifact } from './notification-worker-artifact-contract.mjs';

const roots = [];
const root = path.resolve(import.meta.dirname, '../..');
const builderImage = `oven/bun@sha256:${'a'.repeat(64)}`;

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'notification-worker-artifact-test-'));
  roots.push(directory);
  const payload = path.join(directory, 'payload');
  const output = path.join(directory, 'output');
  await mkdir(path.join(payload, 'build'), { recursive: true });
  await mkdir(path.join(payload, 'ops'), { recursive: true });
  await writeFile(path.join(payload, 'build/index.js'), 'export {};\n');
  await writeFile(
    path.join(payload, 'ops/minion-hub-notification-worker.service'),
    await readFile(path.join(root, 'deploy/systemd/minion-hub-notification-worker.service')),
  );
  await writeFile(
    path.join(payload, 'ops/minion-hub-notification-worker-launcher'),
    await readFile(path.join(root, 'deploy/systemd/minion-hub-notification-worker-launcher')),
  );
  await writeFile(
    path.join(payload, 'ops/verify-disabled-worker.sh'),
    await readFile(path.join(root, 'scripts/ops/verify-disabled-worker.sh')),
  );
  const run = spawnSync(
    'node',
    [
      'scripts/ops/build-notification-worker-artifact.mjs',
      `--output=${output}`,
      '--repository=NikolasP98/minion_hub',
      '--workflow=.github/workflows/notification-worker-artifact.yml',
      `--workflow-commit=${'b'.repeat(40)}`,
      `--workflow-source-commit=${'c'.repeat(40)}`,
      '--run-id=100',
      '--run-attempt=2',
      `--source-commit=${'d'.repeat(40)}`,
      `--source-tree=${'e'.repeat(40)}`,
      `--builder-image=${builderImage}`,
      `--dependency-image=${builderImage}`,
      `--translation-plugin-sha256=sha256:${'f'.repeat(64)}`,
      '--bun-version=1.3.1',
      `--target-node-version=${process.version}`,
      `--target-node-abi=${process.versions.modules}`,
      `--payload-dir=${payload}`,
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, MINION_ARTIFACT_TEST: '1', MINION_PINNED_BUILDER: '1' },
    },
  );
  assert.equal(run.stderr, '');
  assert.equal(run.status, 0);
  return {
    directory,
    archive: path.join(output, 'minion-hub-notification-worker.tar'),
    manifest: path.join(output, 'manifest.json'),
  };
}

afterEach(async () =>
  Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))),
);

test('builds a normalized archive and verifies external identity', async () => {
  const built = await fixture();
  const manifest = JSON.parse(await readFile(built.manifest, 'utf8'));
  const verified = await verifyArtifact({
    archive: built.archive,
    manifestFile: built.manifest,
    expected: {
      archiveSha256: manifest.archiveSha256,
      lockSha256: manifest.lockSha256,
      sourceCommit: manifest.sourceCommit,
      sourceTree: manifest.sourceTree,
      repository: 'NikolasP98/minion_hub',
      workflow: '.github/workflows/notification-worker-artifact.yml',
      runId: '100',
      runAttempt: '2',
    },
  });
  assert.deepEqual(
    verified.inventory.find((entry) => entry.path === 'build/index.js'),
    { path: 'build/index.js', type: 'file', size: 11 },
  );
  await assert.rejects(
    verifyArtifact({
      archive: built.archive,
      manifestFile: built.manifest,
      expected: { archiveSha256: `sha256:${'0'.repeat(64)}` },
    }),
    /expected_archiveSha256/,
  );
  await assert.rejects(
    verifyArtifact({
      archive: built.archive,
      manifestFile: built.manifest,
      expected: { lockSha256: `sha256:${'0'.repeat(64)}` },
    }),
    /expected_lockSha256/,
  );
});

test('rejects links and reserved environment overrides', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'notification-worker-malicious-'));
  roots.push(directory);
  await symlink('/etc/passwd', path.join(directory, 'outside'));
  const archive = path.join(directory, 'bad.tar');
  assert.equal(spawnSync('tar', ['-cf', archive, '-C', directory, 'outside']).status, 0);
  const inspect = spawnSync(
    'python3',
    ['scripts/ops/validate-worker-archive.py', 'inspect', archive],
    { cwd: root, encoding: 'utf8' },
  );
  assert.notEqual(inspect.status, 0);
  assert.match(inspect.stderr, /archive_type/);
  const credentials = path.join(directory, 'credentials');
  await mkdir(credentials);
  await writeFile(path.join(credentials, 'worker.env'), 'HOST=0.0.0.0\n');
  const launch = spawnSync('python3', ['deploy/systemd/minion-hub-notification-worker-launcher'], {
    cwd: root,
    encoding: 'utf8',
    env: { CREDENTIALS_DIRECTORY: credentials },
  });
  assert.notEqual(launch.status, 0);
  assert.match(launch.stderr, /environment_reserved/);
});

test('rejects special, colliding, traversing and unsafe-mode archive entries', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'notification-worker-archive-mutants-'));
  roots.push(directory);
  const script = String.raw`
import io,sys,tarfile
kind,out=sys.argv[1:]
with tarfile.open(out,'w') as t:
 def add(name,type=tarfile.REGTYPE,mode=0o444,link=''):
  x=tarfile.TarInfo(name); x.type=type; x.mode=mode; x.uid=x.gid=0; x.linkname=link
  data=b'x' if type==tarfile.REGTYPE else b''; x.size=len(data); t.addfile(x,io.BytesIO(data))
 if kind=='hardlink': add('a'); add('b',tarfile.LNKTYPE,link='a')
 elif kind=='special': add('pipe',tarfile.FIFOTYPE)
 elif kind=='device': add('device',tarfile.CHRTYPE)
 elif kind=='traversal': add('../outside')
 elif kind=='collision': add('File'); add('file')
 elif kind=='unicode': add('caf\u00e9'); add('cafe\u0301')
 elif kind=='mode': add('unsafe',mode=0o4666)
 elif kind=='sticky': add('unsafe',mode=0o1444)
 elif kind=='xattr':
  x=tarfile.TarInfo('xattr'); x.mode=0o444; x.uid=x.gid=0; x.size=1
  x.pax_headers={'SCHILY.xattr.user.test':'value'}; t.addfile(x,io.BytesIO(b'x'))
 elif kind=='envfile': add('.env')
 elif kind=='credentialurl':
  x=tarfile.TarInfo('url'); x.mode=0o444; x.uid=x.gid=0; data=b'https://user:password@example.test/'
  x.size=len(data); t.addfile(x,io.BytesIO(data))
 elif kind=='customer':
  x=tarfile.TarInfo('customer'); x.mode=0o444; x.uid=x.gid=0; data=b'MINION_ARTIFACT_CUSTOMER_CANARY_DO_NOT_PACKAGE'
  x.size=len(data); t.addfile(x,io.BytesIO(data))
`;
  for (const kind of [
    'hardlink',
    'special',
    'device',
    'traversal',
    'collision',
    'unicode',
    'mode',
    'sticky',
    'xattr',
    'envfile',
    'credentialurl',
    'customer',
  ]) {
    const archive = path.join(directory, `${kind}.tar`);
    assert.equal(spawnSync('python3', ['-c', script, kind, archive]).status, 0);
    const result = spawnSync(
      'python3',
      ['scripts/ops/validate-worker-archive.py', 'inspect', archive],
      { cwd: root, encoding: 'utf8' },
    );
    assert.notEqual(result.status, 0, kind);
  }
});

test('rejects duplicate manifest keys before JavaScript parsing', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'notification-worker-manifest-mutant-'));
  roots.push(directory);
  const manifest = path.join(directory, 'manifest.json');
  await writeFile(manifest, '{"schemaVersion":1,"schemaVersion":1}\n');
  const result = spawnSync(
    'python3',
    ['scripts/ops/validate-worker-archive.py', 'strict-json', manifest],
    { cwd: root, encoding: 'utf8' },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /manifest_duplicate_key/);
});

test('materializes only dependency links contained by the dependency root', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'notification-worker-dependencies-'));
  roots.push(directory);
  const source = path.join(directory, 'source');
  await mkdir(source);
  await symlink('/etc/passwd', path.join(source, 'outside'));
  const run = spawnSync(
    'node',
    ['scripts/ops/materialize-worker-dependencies.mjs', source, path.join(directory, 'output')],
    { cwd: root, encoding: 'utf8' },
  );
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /dependency_outside_root/);

  const cleanSource = path.join(directory, 'clean-source');
  const cleanOutput = path.join(directory, 'clean-output');
  await mkdir(cleanSource);
  await writeFile(path.join(cleanSource, '.env'), 'SECRET=fixture\n');
  await writeFile(path.join(cleanSource, 'index.js'), 'export {};\n');
  const cleanRun = spawnSync(
    'node',
    ['scripts/ops/materialize-worker-dependencies.mjs', cleanSource, cleanOutput],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(cleanRun.status, 0, cleanRun.stderr);
  await assert.rejects(readFile(path.join(cleanOutput, '.env')));
  assert.equal(await readFile(path.join(cleanOutput, 'index.js'), 'utf8'), 'export {};\n');
});

test('rejects sockets in prepared payloads and extraction through a swapped parent', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'notification-worker-runtime-types-'));
  roots.push(directory);
  const socketCheck = spawnSync(
    'python3',
    [
      '-c',
      String.raw`import socket,subprocess,sys
s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1])
r=subprocess.run(['node','scripts/ops/worker-payload-integrity.mjs','create',sys.argv[2]],cwd=sys.argv[3],capture_output=True,text=True)
print(r.stderr,end='',file=sys.stderr); raise SystemExit(0 if r.returncode != 0 and 'payload_type' in r.stderr else 1)`,
      path.join(directory, 'payload.sock'),
      directory,
      root,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(socketCheck.status, 0, socketCheck.stderr);

  const archive = path.join(directory, 'parent.tar');
  const source = path.join(directory, 'source');
  await mkdir(path.join(source, 'parent'), { recursive: true });
  await writeFile(path.join(source, 'parent/file'), 'safe');
  assert.equal(
    spawnSync('tar', [
      '--owner=0',
      '--group=0',
      '--numeric-owner',
      '-cf',
      archive,
      '-C',
      source,
      '.',
    ]).status,
    0,
  );
  const destination = path.join(directory, 'destination');
  await mkdir(path.join(destination, 'parent'), { recursive: true });
  const hook = path.join(directory, 'extract-hook');
  const extracted = spawnSync(
    'python3',
    [
      '-c',
      String.raw`import os,subprocess,sys,time
root,archive,destination,hook=sys.argv[1:]
env={**os.environ,'WORKER_EXTRACT_ROOT':destination,'WORKER_EXTRACT_TEST_HOOK':hook,'MINION_ARTIFACT_TEST':'1'}
p=subprocess.Popen(['python3','scripts/ops/validate-worker-archive.py','extract',archive],cwd=root,env=env,stderr=subprocess.PIPE,text=True)
for _ in range(500):
 if os.path.exists(hook+'.ready'): break
 time.sleep(.01)
else: p.kill(); raise SystemExit(2)
os.rmdir(os.path.join(destination,'parent')); os.symlink('/tmp',os.path.join(destination,'parent'))
open(hook+'.continue','w').close(); _,err=p.communicate(timeout=10)
print(err,end='',file=sys.stderr); raise SystemExit(0 if p.returncode != 0 else 1)`,
      root,
      archive,
      destination,
      hook,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(extracted.status, 0, extracted.stderr);
});

test('keeps installation and workflow disabled and provenance-bound', async () => {
  const installer = await readFile(
    path.join(root, 'scripts/ops/install-notification-worker-artifact.sh'),
    'utf8',
  );
  assert.doesNotMatch(installer, /systemctl\s+(?:enable|start|restart|try-restart)\b/);
  assert.match(installer, /gh attestation verify/);
  const unit = await readFile(
    path.join(root, 'deploy/systemd/minion-hub-notification-worker.service'),
    'utf8',
  );
  assert.match(unit, /ConditionPathExists=\/etc\/minion\/notification-worker\.activation-approved/);
  assert.doesNotMatch(unit, /^\[Install\]$/m);
  assert.doesNotMatch(unit, /^MemoryDenyWriteExecute=/m);
  const workflow = await readFile(
    path.join(root, '.github/workflows/notification-worker-artifact.yml'),
    'utf8',
  );
  assert.match(
    workflow,
    /actions\/attest-build-provenance@977bb373ede98d70efdf65b84cb5f73e068dcc2a/,
  );
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(workflow, /MINION_WORKER_ARTIFACT_BUILD=1/);
  assert.match(workflow, /NOTIFICATION_BUILD_SHA="\$SOURCE_SHA"/);

  const privateGate = workflow.match(
    /- name: Reject artifact publication from a public repository\n(?: {8}.*\n)*? {8}run: \|\n((?: {10}.*\n)+)/,
  );
  assert.ok(privateGate, 'workflow must contain the executable repository privacy gate');
  const privateGateScript = privateGate[1].replace(/^ {10}/gm, '');
  for (const [repositoryPrivate, expectedStatus] of [
    ['true', 0],
    ['false', 1],
    ['', 1],
  ]) {
    const result = spawnSync('bash', ['-eu', '-o', 'pipefail', '-c', privateGateScript], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, REPOSITORY_PRIVATE: repositoryPrivate },
    });
    assert.equal(result.status, expectedStatus, result.stderr);
  }
  assert.match(workflow, /disabled-systemd-gate:\n {4}needs: private-repository-gate/);

  const invalidDeterministicIdentity = spawnSync(
    'node',
    [
      '-e',
      "import('./scripts/config/worker-artifact-version.js').then(({workerArtifactVersion:f})=>f())",
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        MINION_WORKER_ARTIFACT_BUILD: '1',
        NOTIFICATION_BUILD_SHA: 'moving-ref',
      },
    },
  );
  assert.notEqual(invalidDeterministicIdentity.status, 0);
  assert.match(invalidDeterministicIdentity.stderr, /exact notification source SHA/);
  const standardConfig = spawnSync(
    'node',
    [
      '-e',
      "import('./scripts/config/worker-artifact-version.js').then(({workerArtifactVersion:f})=>{if(f()!==undefined)process.exit(1)})",
    ],
    { cwd: root, encoding: 'utf8', env: process.env },
  );
  assert.equal(standardConfig.status, 0, standardConfig.stderr);

  for (const status of ['401', '403']) {
    const rejectedHealth = spawnSync(
      'sh',
      ['scripts/ops/verify-disabled-worker.sh', 'fixture.service', status],
      { cwd: root, encoding: 'utf8' },
    );
    assert.notEqual(rejectedHealth.status, 0);
    assert.match(rejectedHealth.stderr, /accepts_no_http_status/);
  }
});

test('binds the manifest digest separately from the archive digest', async () => {
  const built = await fixture();
  assert.match(await sha256File(built.manifest), /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(await sha256File(built.manifest), await sha256File(built.archive));
});

test('rejects installer execution without root before reading artifact inputs', () => {
  if (process.getuid?.() === 0) return;
  const run = spawnSync('sh', ['scripts/ops/install-notification-worker-artifact.sh'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /installer_requires_root/);
});

test('detects installed payload byte changes before idempotent reuse', async () => {
  const built = await fixture();
  const extracted = path.join(built.directory, 'extracted');
  await mkdir(extracted);
  const extract = spawnSync(
    'python3',
    ['scripts/ops/validate-worker-archive.py', 'extract', built.archive],
    { cwd: root, encoding: 'utf8', env: { ...process.env, WORKER_EXTRACT_ROOT: extracted } },
  );
  assert.equal(extract.status, 0, extract.stderr);
  const verify = () =>
    spawnSync('node', ['scripts/ops/worker-payload-integrity.mjs', 'verify', extracted], {
      cwd: root,
      encoding: 'utf8',
    });
  assert.equal(verify().status, 0);
  await chmod(path.join(extracted, 'build/index.js'), 0o644);
  await writeFile(path.join(extracted, 'build/index.js'), 'tampered\n');
  const changed = verify();
  assert.notEqual(changed.status, 0);
  assert.match(changed.stderr, /payload_integrity/);
});

test(
  'executes the root installer idempotently and rolls back a failed unit reload',
  { skip: process.getuid?.() !== 0 },
  async () => {
    const built = await fixture();
    const manifest = JSON.parse(await readFile(built.manifest, 'utf8'));
    const manifestSha = await sha256File(built.manifest);
    const tools = path.join(built.directory, 'tools');
    await mkdir(tools);
    await writeFile(
      path.join(tools, 'gh'),
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$MOCK_GH_LOG"\nif [ -n "${MOCK_MUTATE_ORIGINAL:-}" ]; then printf replaced > "$MOCK_MUTATE_ORIGINAL"; fi\nexit "${MOCK_GH_STATUS:-0}"\n',
      { mode: 0o755 },
    );
    await writeFile(
      path.join(tools, 'systemctl'),
      `#!/bin/sh
printf '%s\n' "$*" >> "$MOCK_SYSTEMCTL_LOG"
case "$1" in enable|start|restart|try-restart) exit 88;; esac
if [ "$1" = daemon-reload ] && [ "${'${MOCK_FAIL_DAEMON:-0}'}" = 1 ]; then exit 9; fi
if [ "$1" = is-active ] && [ "${'${MOCK_ACTIVE:-0}'}" = 1 ]; then exit 0; fi
case "$1" in is-active|is-enabled) exit 1;; *) exit 0;; esac
`,
      { mode: 0o755 },
    );
    await writeFile(
      path.join(tools, 'mv'),
      `#!/bin/sh
for last do :; done
case "$last" in */current) if [ "${'${MOCK_FAIL_POINTER:-0}'}" = 1 ]; then exit 7; fi;; esac
exec /bin/mv "$@"
`,
      { mode: 0o755 },
    );
    const bundle = path.join(built.directory, 'attestation.jsonl');
    await writeFile(bundle, '{}\n');
    const installRoot = `/root/minion-worker-test-${process.pid}-${Date.now()}`;
    roots.push(installRoot);
    await mkdir(installRoot);
    const args = [
      'scripts/ops/install-notification-worker-artifact.sh',
      built.archive,
      built.manifest,
      manifestSha,
      bundle,
      manifest.archiveSha256,
      manifest.lockSha256,
      manifest.sourceCommit,
      manifest.sourceTree,
      manifest.repository,
      manifest.workflow,
      manifest.workflowCommit,
      manifest.workflowSourceCommit,
      manifest.runId,
      manifest.runAttempt,
      manifest.builderImage,
      manifest.dependencyImage,
      manifest.translationPluginSha256,
      installRoot,
    ];
    const ghLog = path.join(built.directory, 'gh.log');
    const systemctlLog = path.join(built.directory, 'systemctl.log');
    const env = {
      ...process.env,
      PATH: `${tools}:${process.env.PATH}`,
      MOCK_GH_LOG: ghLog,
      MOCK_SYSTEMCTL_LOG: systemctlLog,
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      const run = spawnSync('sh', args, { cwd: root, encoding: 'utf8', env });
      assert.equal(run.status, 0, run.stderr);
    }
    const current = path.join(installRoot, 'opt/minion/hub-notification-worker/current');
    assert.equal((await readFile(path.join(current, '.manifest.json'), 'utf8')).length > 0, true);
    const pointerBefore = await readlink(current);
    const unit = path.join(
      installRoot,
      'etc/systemd/system/minion-hub-notification-worker.service',
    );
    const unitBefore = await readFile(unit);
    const attestationCalls = await readFile(ghLog, 'utf8');
    assert.match(attestationCalls, new RegExp(`--signer-digest ${manifest.workflowCommit}`));
    assert.match(attestationCalls, new RegExp(`--source-digest ${manifest.workflowSourceCommit}`));
    assert.match(attestationCalls, /--deny-self-hosted-runners/);
    assert.doesNotMatch(
      await readFile(systemctlLog, 'utf8'),
      /^(?:enable|start|restart|try-restart)\b/m,
    );
    const unitInfo = await stat(unit);
    assert.equal(unitInfo.uid, 0);
    assert.equal(unitInfo.mode & 0o022, 0);
    const releaseInfo = await stat(await realpath(current));
    assert.equal(releaseInfo.uid, 0);
    assert.equal(releaseInfo.mode & 0o022, 0);

    const noncanonical = spawnSync('sh', [...args.slice(0, -1), `${installRoot}/.`], {
      cwd: root,
      encoding: 'utf8',
      env,
    });
    assert.notEqual(noncanonical.status, 0);
    assert.match(noncanonical.stderr, /unsafe_ancestry/);
    assert.equal(await readlink(current), pointerBefore);

    const controlDirectory = path.join(installRoot, 'etc/minion');
    await mkdir(controlDirectory, { recursive: true });
    const environmentFile = path.join(controlDirectory, 'hub-notification-worker.env');
    await writeFile(environmentFile, 'opaque\n', { mode: 0o644 });
    const unsafeEnvironment = spawnSync('sh', args, { cwd: root, encoding: 'utf8', env });
    assert.notEqual(unsafeEnvironment.status, 0);
    assert.match(unsafeEnvironment.stderr, /unsafe_control_file/);
    assert.equal(await readlink(current), pointerBefore);
    await chmod(environmentFile, 0o600);
    await chown(environmentFile, 1, 1);
    const unownedEnvironment = spawnSync('sh', args, { cwd: root, encoding: 'utf8', env });
    assert.notEqual(unownedEnvironment.status, 0);
    assert.match(unownedEnvironment.stderr, /unsafe_control_file/);
    await chown(environmentFile, 0, 0);
    const marker = path.join(controlDirectory, 'notification-worker.activation-approved');
    await writeFile(marker, '', { mode: 0o666 });
    const writableMarker = spawnSync('sh', args, { cwd: root, encoding: 'utf8', env });
    assert.notEqual(writableMarker.status, 0);
    assert.match(writableMarker.stderr, /activation_marker_present/);
    await chmod(marker, 0o444);
    const safeModeMarker = spawnSync('sh', args, { cwd: root, encoding: 'utf8', env });
    assert.notEqual(safeModeMarker.status, 0);
    assert.match(safeModeMarker.stderr, /activation_marker_present/);
    await rm(marker);
    await symlink('/tmp/notif003-activation', marker);
    const symlinkMarker = spawnSync('sh', args, { cwd: root, encoding: 'utf8', env });
    assert.notEqual(symlinkMarker.status, 0);
    assert.match(symlinkMarker.stderr, /activation_marker_present/);
    await rm(marker);

    await rm(controlDirectory, { recursive: true });
    await symlink('/tmp', controlDirectory);
    const controlAncestor = spawnSync('sh', args, { cwd: root, encoding: 'utf8', env });
    assert.notEqual(controlAncestor.status, 0);
    assert.match(controlAncestor.stderr, /unsafe_control_file/);
    await rm(controlDirectory);

    const interruptedRoot = `${installRoot}-interrupted`;
    roots.push(interruptedRoot);
    await mkdir(interruptedRoot);
    const interruptedHook = path.join(built.directory, 'interrupted-extract');
    const interrupted = spawnSync('sh', [...args.slice(0, -1), interruptedRoot], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...env,
        MINION_ARTIFACT_TEST: '1',
        WORKER_EXTRACT_TEST_HOOK: interruptedHook,
      },
    });
    assert.notEqual(interrupted.status, 0);
    const interruptedReleases = path.join(
      interruptedRoot,
      'opt/minion/hub-notification-worker/releases',
    );
    assert.deepEqual(
      (await readdir(interruptedReleases)).filter((name) => name.startsWith('.stage-')),
      [],
    );
    await assert.rejects(
      readlink(path.join(interruptedRoot, 'opt/minion/hub-notification-worker/current')),
    );

    const failedExisting = spawnSync('sh', args, {
      cwd: root,
      encoding: 'utf8',
      env: { ...env, MOCK_FAIL_DAEMON: '1' },
    });
    assert.notEqual(failedExisting.status, 0);
    assert.equal(await readlink(current), pointerBefore);
    assert.deepEqual(await readFile(unit), unitBefore);

    const failedPointer = spawnSync('sh', args, {
      cwd: root,
      encoding: 'utf8',
      env: { ...env, MOCK_FAIL_POINTER: '1' },
    });
    assert.notEqual(failedPointer.status, 0);
    assert.equal(await readlink(current), pointerBefore);
    assert.deepEqual(await readFile(unit), unitBefore);
    assert.deepEqual(
      (await readdir(path.dirname(current))).filter((name) => name.startsWith('current.new.')),
      [],
    );

    const failedRoot = `${installRoot}-failed`;
    roots.push(failedRoot);
    await mkdir(failedRoot);
    const failedArgs = [...args.slice(0, -1), failedRoot];
    const failed = spawnSync('sh', failedArgs, {
      cwd: root,
      encoding: 'utf8',
      env: { ...env, MOCK_FAIL_DAEMON: '1' },
    });
    assert.notEqual(failed.status, 0);
    await assert.rejects(
      readFile(path.join(failedRoot, 'opt/minion/hub-notification-worker/current')),
    );
    await assert.rejects(
      readFile(path.join(failedRoot, 'etc/systemd/system/minion-hub-notification-worker.service')),
    );

    const rejectedRoot = `${installRoot}-rejected`;
    roots.push(rejectedRoot);
    await mkdir(rejectedRoot);
    const rejectedArgs = [...args.slice(0, -1), rejectedRoot];
    const rejected = spawnSync('sh', rejectedArgs, {
      cwd: root,
      encoding: 'utf8',
      env: { ...env, MOCK_GH_STATUS: '1' },
    });
    assert.notEqual(rejected.status, 0);
    await assert.rejects(readFile(path.join(rejectedRoot, 'opt/minion')));

    const unsafeRoot = `${installRoot}-unsafe`;
    roots.push(unsafeRoot);
    await symlink('/tmp', unsafeRoot);
    const unsafe = spawnSync('sh', [...args.slice(0, -1), unsafeRoot], {
      cwd: root,
      encoding: 'utf8',
      env,
    });
    assert.notEqual(unsafe.status, 0);
    assert.match(unsafe.stderr, /unsafe_ancestry/);

    const ancestryBase = `${installRoot}-ancestry`;
    const ancestryReal = `${installRoot}-ancestry-real`;
    roots.push(ancestryBase, ancestryReal);
    await mkdir(path.join(ancestryBase), { recursive: true });
    await mkdir(path.join(ancestryReal, 'target'), { recursive: true });
    await symlink(ancestryReal, path.join(ancestryBase, 'link'));
    const unsafeAncestor = spawnSync(
      'sh',
      [...args.slice(0, -1), path.join(ancestryBase, 'link/target')],
      { cwd: root, encoding: 'utf8', env },
    );
    assert.notEqual(unsafeAncestor.status, 0);
    assert.match(unsafeAncestor.stderr, /unsafe_ancestry/);

    const danglingRoot = `${installRoot}-dangling`;
    roots.push(danglingRoot);
    await symlink(`${danglingRoot}-missing`, danglingRoot);
    const dangling = spawnSync('sh', [...args.slice(0, -1), danglingRoot], {
      cwd: root,
      encoding: 'utf8',
      env,
    });
    assert.notEqual(dangling.status, 0);
    assert.match(dangling.stderr, /unsafe_ancestry/);

    const activeRoot = `${installRoot}-active`;
    roots.push(activeRoot);
    await mkdir(activeRoot);
    const active = spawnSync('sh', [...args.slice(0, -1), activeRoot], {
      cwd: root,
      encoding: 'utf8',
      env: { ...env, MOCK_ACTIVE: '1' },
    });
    assert.notEqual(active.status, 0);
    assert.match(active.stderr, /service_active/);
    await assert.rejects(readFile(path.join(activeRoot, 'opt/minion')));

    const raceArchive = path.join(built.directory, 'race-archive.tar');
    await copyFile(built.archive, raceArchive);
    const raceRoot = `${installRoot}-race`;
    roots.push(raceRoot);
    await mkdir(raceRoot);
    const raceArgs = [...args];
    raceArgs[1] = raceArchive;
    raceArgs[raceArgs.length - 1] = raceRoot;
    const raced = spawnSync('sh', raceArgs, {
      cwd: root,
      encoding: 'utf8',
      env: { ...env, MOCK_MUTATE_ORIGINAL: raceArchive },
    });
    assert.equal(raced.status, 0, raced.stderr);
    assert.equal(
      await readlink(path.join(raceRoot, 'opt/minion/hub-notification-worker/current')),
      pointerBefore,
    );

    const release = await realpath(current);
    const releaseParent = path.dirname(release);
    const releaseName = path.basename(release);
    const symlinkedReleaseRoot = `${installRoot}-release-link`;
    roots.push(symlinkedReleaseRoot);
    await mkdir(symlinkedReleaseRoot);
    const symlinkArgs = [...args.slice(0, -1), symlinkedReleaseRoot];
    assert.equal(spawnSync('sh', symlinkArgs, { cwd: root, encoding: 'utf8', env }).status, 0);
    const symlinkRelease = path.join(
      symlinkedReleaseRoot,
      'opt/minion/hub-notification-worker/releases',
      releaseName,
    );
    await rm(symlinkRelease, { recursive: true });
    await symlink(path.join(releaseParent, releaseName), symlinkRelease);
    const symlinkReuse = spawnSync('sh', symlinkArgs, { cwd: root, encoding: 'utf8', env });
    assert.notEqual(symlinkReuse.status, 0);
    assert.match(symlinkReuse.stderr, /occupied_release/);

    const writableDirectory = path.join(release, 'build');
    await chmod(writableDirectory, 0o777);
    const writableReuse = spawnSync('sh', args, { cwd: root, encoding: 'utf8', env });
    assert.notEqual(writableReuse.status, 0);
    assert.match(writableReuse.stderr, /occupied_release/);
    await chmod(writableDirectory, 0o555);

    await rm(unit);
    const externalUnit = path.join(built.directory, 'external-unit');
    await writeFile(externalUnit, unitBefore, { mode: 0o444 });
    await symlink(externalUnit, unit);
    const symlinkUnit = spawnSync('sh', args, { cwd: root, encoding: 'utf8', env });
    assert.notEqual(symlinkUnit.status, 0);
    assert.match(symlinkUnit.stderr, /unit_unsafe/);
    assert.equal(await readlink(current), pointerBefore);
    await rm(unit);
    const missingExternalUnit = path.join(built.directory, 'missing-external-unit');
    await symlink(missingExternalUnit, unit);
    const danglingUnit = spawnSync('sh', args, { cwd: root, encoding: 'utf8', env });
    assert.notEqual(danglingUnit.status, 0);
    assert.match(danglingUnit.stderr, /unit_unsafe/);
    await assert.rejects(readFile(missingExternalUnit));
    assert.equal(await readlink(current), pointerBefore);
    await rm(unit);
    await writeFile(unit, unitBefore, { mode: 0o666 });
    await chmod(unit, 0o666);
    const writableUnit = spawnSync('sh', args, { cwd: root, encoding: 'utf8', env });
    assert.notEqual(writableUnit.status, 0);
    assert.match(writableUnit.stderr, /unit_unsafe/);
    assert.equal(await readlink(current), pointerBefore);
  },
);
