import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { test } from 'node:test';
import {
  validateAdmission,
  validateProtectedEnvironment,
  validateLockSources,
  stageBuildSubjects,
  createSourceInventory,
  verifySourceInventory,
  validateWorkflowContract,
  verifyGh,
} from './private-worker-workflow-contract.mjs';

const good = {
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REPOSITORY: 'NikolasP98/minion_hub',
  EXPECTED_REPOSITORY: 'NikolasP98/minion_hub',
  GITHUB_REF: 'refs/heads/master',
  GITHUB_SHA: 'a'.repeat(40),
  GITHUB_WORKFLOW_SHA: 'a'.repeat(40),
  SOURCE_SHA: 'a'.repeat(40),
  LOCK_SHA256: `sha256:${'b'.repeat(64)}`,
  PUBLIC_PROVENANCE_APPROVED: 'true',
  LIVE_CONFIG_APPROVED: 'true',
};

test('admission binds the exact master workflow, payload and explicit approvals', () => {
  validateAdmission(good);
  for (const [field, value] of [
    ['GITHUB_EVENT_NAME', 'push'],
    ['EXPECTED_REPOSITORY', 'attacker/fork'],
    ['GITHUB_REF', 'refs/heads/dev'],
    ['GITHUB_WORKFLOW_SHA', 'c'.repeat(40)],
    ['SOURCE_SHA', 'c'.repeat(40)],
    ['LOCK_SHA256', 'moving'],
    ['PUBLIC_PROVENANCE_APPROVED', 'false'],
    ['LIVE_CONFIG_APPROVED', ''],
  ])
    assert.throws(() => validateAdmission({ ...good, [field]: value }));
});

test('actual preflight uses contents and actions readable endpoints and fails closed', () => {
  const env = {
    REPOSITORY: 'NikolasP98/minion_hub',
    ENVIRONMENT_NAME: 'notification-worker-private-publication',
    GH_TOKEN: 'fixture-token',
  };
  const calls = [];
  const execute = (_command, argv) => {
    const endpoint = argv[1];
    calls.push(endpoint);
    if (endpoint.endsWith('/branches/master'))
      return { status: 0, stdout: JSON.stringify({ protected: true }), stderr: '' };
    if (endpoint.includes('/environments/'))
      return {
        status: 0,
        stdout: JSON.stringify({
          protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User' }] }],
          deployment_branch_policy: { protected_branches: true },
        }),
        stderr: '',
      };
    throw new Error(`unexpected endpoint: ${endpoint}`);
  };
  validateProtectedEnvironment(env, execute);
  assert.deepEqual(calls, [
    'repos/NikolasP98/minion_hub/branches/master',
    'repos/NikolasP98/minion_hub/environments/notification-worker-private-publication',
  ]);
  assert.equal(
    calls.some((endpoint) => endpoint.endsWith('/protection')),
    false,
  );
  assert.throws(() =>
    validateProtectedEnvironment(env, (_command, argv) => ({
      status: 0,
      stdout: JSON.stringify(
        argv[1].endsWith('/branches/master')
          ? { protected: false }
          : {
              protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User' }] }],
              deployment_branch_policy: { protected_branches: true },
            },
      ),
      stderr: '',
    })),
  );
  assert.throws(() =>
    validateProtectedEnvironment(env, (_command, argv) => ({
      status: 0,
      stdout: JSON.stringify(
        argv[1].endsWith('/branches/master')
          ? { protected: true }
          : {
              protection_rules: [{ type: 'required_reviewers', reviewers: 'not-an-array' }],
              deployment_branch_policy: { protected_branches: true },
            },
      ),
      stderr: '',
    })),
  );
  assert.throws(() =>
    validateProtectedEnvironment(env, (_command, argv) => ({
      status: 0,
      stdout: JSON.stringify(
        argv[1].endsWith('/branches/master')
          ? { protected: true }
          : {
              protection_rules: [{ type: 'required_reviewers', reviewers: [] }],
              deployment_branch_policy: { protected_branches: true },
            },
      ),
      stderr: '',
    })),
  );
  assert.throws(() =>
    validateProtectedEnvironment(env, (_command, argv) =>
      argv[1].includes('/environments/')
        ? { status: 1, stdout: '', stderr: 'HTTP 403 fixture' }
        : { status: 0, stdout: JSON.stringify({ protected: true }), stderr: '' },
    ),
  );
});

test('preflight executable enforces the mocked GitHub permission model', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'worker-preflight-'));
  try {
    const binary = path.join(root, 'gh');
    const log = path.join(root, 'requests.log');
    await writeFile(
      binary,
      `#!/bin/sh
set -eu
fixture_root='${root}'
test "$1" = api
printf '%s\\n' "$2" >> "$fixture_root/requests.log"
case "$2" in
  */branches/master)
    test ! -e "$fixture_root/unprotected" || { echo '{"protected":false}'; exit 0; }
    echo '{"protected":true}' ;;
  */environments/*)
    test ! -e "$fixture_root/forbidden" || exit 22
    test ! -e "$fixture_root/malformed" || { echo 'not-json'; exit 0; }
    if test -e "$fixture_root/missing-reviewers"; then
      echo '{"protection_rules":[{"type":"required_reviewers","reviewers":[]}],"deployment_branch_policy":{"protected_branches":true}}'
    else
      echo '{"protection_rules":[{"type":"required_reviewers","reviewers":[{"type":"User"}]}],"deployment_branch_policy":{"protected_branches":true}}'
    fi ;;
  *) exit 23 ;;
esac
`,
    );
    await chmod(binary, 0o755);
    const baseEnv = {
      ...process.env,
      PATH: `${root}:${process.env.PATH}`,
      GH_TOKEN: 'fixture-token',
      REPOSITORY: 'NikolasP98/minion_hub',
      ENVIRONMENT_NAME: 'notification-worker-private-publication',
    };
    const invoke = () =>
      spawnSync('node', ['scripts/ops/private-worker-workflow-contract.mjs', 'preflight'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: baseEnv,
      });
    assert.equal(invoke().status, 0);
    const endpoints = (await readFile(log, 'utf8')).trim().split('\n');
    assert.deepEqual(endpoints, [
      'repos/NikolasP98/minion_hub/branches/master',
      'repos/NikolasP98/minion_hub/environments/notification-worker-private-publication',
    ]);
    assert.equal(
      endpoints.some((endpoint) => endpoint.endsWith('/protection')),
      false,
    );
    await writeFile(path.join(root, 'unprotected'), '');
    assert.notEqual(invoke().status, 0);
    await rm(path.join(root, 'unprotected'));
    await writeFile(path.join(root, 'missing-reviewers'), '');
    assert.notEqual(invoke().status, 0);
    await rm(path.join(root, 'missing-reviewers'));
    await writeFile(path.join(root, 'forbidden'), '');
    assert.notEqual(invoke().status, 0);
    await rm(path.join(root, 'forbidden'));
    await writeFile(path.join(root, 'malformed'), '');
    assert.notEqual(invoke().status, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('tracked source inventory detects post-export byte and symlink changes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'worker-inventory-'));
  try {
    await writeFile(path.join(root, 'source.js'), 'reviewed');
    const inventory = `${root}.json`;
    await createSourceInventory(root, inventory);
    await verifySourceInventory(root, inventory);
    await mkdir(path.join(root, 'generated-large-tree'));
    await writeFile(
      path.join(root, 'generated-large-tree', 'ignored.bin'),
      Buffer.alloc(8 * 1024 * 1024),
    );
    await chmod(path.join(root, 'generated-large-tree'), 0o000);
    await verifySourceInventory(root, inventory);
    await chmod(path.join(root, 'generated-large-tree'), 0o700);
    await writeFile(path.join(root, 'source.js'), 'malicious');
    await assert.rejects(verifySourceInventory(root, inventory), /source_changed/);
    await rm(inventory, { force: true });
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(`${root}.json`, { force: true });
  }
});

test('stages only no-follow regular build subjects into a private directory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'worker-build-'));
  await (await import('node:fs/promises')).chmod(root, 0o700);
  try {
    const artifact = path.join(root, 'notification-worker-artifact');
    await (await import('node:fs/promises')).mkdir(artifact, { mode: 0o700 });
    await writeFile(path.join(artifact, 'minion-hub-notification-worker.tar'), 'archive');
    await writeFile(path.join(artifact, 'manifest.json'), 'manifest');
    const output = `${root}-output`;
    await stageBuildSubjects(root, output);
    assert.equal(await readFile(path.join(output, 'manifest.json'), 'utf8'), 'manifest');
    await rm(output, { recursive: true, force: true });
    await rm(path.join(artifact, 'manifest.json'));
    await (
      await import('node:fs/promises')
    ).symlink('/etc/passwd', path.join(artifact, 'manifest.json'));
    await assert.rejects(stageBuildSubjects(root, output));
    await assert.rejects(readFile(output), /ENOENT|EISDIR/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(`${root}-output`, { recursive: true, force: true });
  }
});

test('dependency lock allows only registry identities and reviewed local tarballs', async () => {
  await validateLockSources('bun.lock');
  const root = await mkdtemp(path.join(tmpdir(), 'worker-lock-'));
  try {
    for (const source of [
      'https://evil.example/pkg.tgz',
      'git+ssh://evil/repo',
      'file:../escape.tgz',
    ]) {
      const file = path.join(root, 'bun.lock');
      await writeFile(file, JSON.stringify({ source }));
      await assert.rejects(validateLockSources(file), /lock_(remote|local)_source/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('GitHub CLI identity is externally pinned', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'worker-gh-'));
  try {
    const binary = path.join(root, 'gh');
    await writeFile(binary, 'pinned-gh');
    const digest = 'sha256:599cbc4897988ba74c1d55bf3db75564fba9d9fc0bb2b4190b7e84460927a24e';
    await verifyGh(binary, '2.101.0', digest);
    await assert.rejects(verifyGh(binary, '2.101.0', `sha256:${'0'.repeat(64)}`), /gh_digest/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('actual workflow preserves source and credential handoff boundaries', async () => {
  const workflow = await readFile(
    '.github/workflows/notification-worker-private-publish.yml',
    'utf8',
  );
  validateWorkflowContract(workflow);
  for (const mutation of [
    workflow.replace('      actions: read', '      actions: none'),
    workflow.replace('ref: ${{ github.workflow_sha }}', 'ref: refs/heads/master'),
    workflow.replace('persist-credentials: false', 'persist-credentials: true'),
    workflow.replace('node-version: 22.20.0', 'node-version: current'),
    workflow.replace(
      'run: node scripts/ops/private-worker-workflow-contract.mjs preflight',
      'run: echo preflight-skipped',
    ),
    workflow.replaceAll('path: source-checkout', 'path: mutable-source'),
    workflow.replaceAll('--ignore-scripts', '--trust-scripts'),
    workflow.replaceAll('--network=none', '--network=host'),
    workflow.replaceAll('--cap-drop=ALL', '--cap-add=ALL'),
    workflow.replace('Build immutable disabled artifact', 'Build removed'),
    workflow.replace('-v "$BUILD_ROOT:/work"', '-v "$PWD:/work"'),
    workflow.replace(
      'trusted-publisher/scripts/ops/run-private-worker-publisher-container.sh',
      'source-checkout/attacker.sh',
    ),
  ])
    assert.throws(() => validateWorkflowContract(mutation));
});

test('actual pinned publisher container receives owned inputs and writable disk scratch', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'worker-publisher-container-'));
  try {
    const trusted = path.join(root, 'trusted');
    const artifact = path.join(root, 'artifact');
    await mkdir(path.join(trusted, 'fixtures'), { recursive: true });
    await mkdir(artifact);
    await writeFile(path.join(root, 'authority.json'), '{}\n', { mode: 0o400 });
    for (const [name, bytes] of [
      ['minion-hub-notification-worker.tar', 'archive'],
      ['manifest.json', 'manifest'],
      ['attestation.jsonl', 'attestation'],
    ])
      await writeFile(path.join(artifact, name), bytes);
    await writeFile(
      path.join(trusted, 'fixtures', 'publisher-boundary.mjs'),
      `import { lstat, mkdtemp, readFile } from 'node:fs/promises';
       import { spawnSync } from 'node:child_process';
       for (const directory of ['/inputs', process.env.RUNNER_TEMP]) {
         if ((await lstat(directory)).uid !== process.geteuid()) throw new Error('owner');
       }
       if (process.env.TMPDIR !== '/private-temp') throw new Error('tmpdir');
       await mkdtemp(process.env.TMPDIR + '/verify-');
       if (!String(await readFile('/inputs/authority.json')).includes('{}')) throw new Error('input');
       if (spawnSync('/usr/local/bin/gh', ['--version']).status !== 0) throw new Error('gh');\n`,
    );
    const gh = path.join(root, 'gh');
    await writeFile(gh, '#!/bin/sh\necho "gh version 2.101.0 (test)"\n');
    await chmod(gh, 0o755);
    const before = new Set(await readdir(root));
    const result = spawnSync('scripts/ops/run-private-worker-publisher-container.sh', [], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        RUNNER_TEMP: root,
        PUBLISHER_IMAGE:
          'node@sha256:915acd9e9b885ead0c620e27e37c81b74c226e0e1c8177f37a60217b6eabb0d7',
        PUBLISHER_TRUSTED_DIR: trusted,
        PUBLISHER_AUTHORITY_FILE: path.join(root, 'authority.json'),
        PUBLISHER_ARTIFACT_DIR: artifact,
        PUBLISHER_GH_PATH: gh,
        MINION_ARTIFACT_TEST: '1',
        PUBLISHER_TEST_ENTRYPOINT: 'fixtures/publisher-boundary.mjs',
        WORKER_ARTIFACT_B2_PUBLISHER_KEY_ID: 'synthetic-key',
        WORKER_ARTIFACT_B2_PUBLISHER_APPLICATION_KEY: 'synthetic-secret',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(new Set(await readdir(root)), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('publisher cancellation stops and removes only its cidfile-owned container', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'worker-publisher-cancel-'));
  try {
    const trusted = path.join(root, 'trusted');
    const artifact = path.join(root, 'artifact');
    await mkdir(path.join(trusted, 'fixtures'), { recursive: true });
    await mkdir(artifact);
    await writeFile(path.join(root, 'authority.json'), '{}\n', { mode: 0o400 });
    for (const name of ['minion-hub-notification-worker.tar', 'manifest.json', 'attestation.jsonl'])
      await writeFile(path.join(artifact, name), name);
    await writeFile(
      path.join(trusted, 'fixtures', 'wait.mjs'),
      `await new Promise((resolve) => setTimeout(resolve, 30_000));\n`,
    );
    const gh = path.join(root, 'gh');
    await writeFile(gh, '#!/bin/sh\nexit 0\n');
    await chmod(gh, 0o755);
    const child = spawn('scripts/ops/run-private-worker-publisher-container.sh', [], {
      cwd: process.cwd(),
      stdio: 'ignore',
      env: {
        ...process.env,
        RUNNER_TEMP: root,
        PUBLISHER_IMAGE:
          'node@sha256:915acd9e9b885ead0c620e27e37c81b74c226e0e1c8177f37a60217b6eabb0d7',
        PUBLISHER_TRUSTED_DIR: trusted,
        PUBLISHER_AUTHORITY_FILE: path.join(root, 'authority.json'),
        PUBLISHER_ARTIFACT_DIR: artifact,
        PUBLISHER_GH_PATH: gh,
        MINION_ARTIFACT_TEST: '1',
        PUBLISHER_TEST_ENTRYPOINT: 'fixtures/wait.mjs',
        WORKER_ARTIFACT_B2_PUBLISHER_KEY_ID: 'synthetic-key',
        WORKER_ARTIFACT_B2_PUBLISHER_APPLICATION_KEY: 'synthetic-secret',
      },
    });
    let cid;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const directory = (await readdir(root)).find((name) =>
        name.startsWith('private-worker-publisher.'),
      );
      if (directory) {
        try {
          cid = (await readFile(path.join(root, directory, 'container.cid'), 'utf8')).trim();
        } catch {}
      }
      if (cid) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.match(cid ?? '', /^[0-9a-f]{64}$/);
    const exited = new Promise((resolve) =>
      child.once('exit', (code, signal) => resolve({ code, signal })),
    );
    child.kill('SIGTERM');
    const exit = await exited;
    assert.ok(exit.code === 143 || exit.signal === 'SIGTERM');
    assert.notEqual(spawnSync('docker', ['inspect', cid]).status, 0);
    assert.equal(
      (await readdir(root)).some((name) => name.startsWith('private-worker-publisher.')),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
