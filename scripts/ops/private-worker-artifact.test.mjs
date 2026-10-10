import assert from 'node:assert/strict';
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, test } from 'node:test';
import {
  canonicalReceiptBytes,
  parseCanonicalReceipt,
  sha256Bytes,
} from './private-worker-artifact-contract.mjs';
import {
  createB2Client,
  publishPrivateArtifactFiles,
  retrievePrivateArtifactFiles,
  validateAuthorizeResponse,
  validatePrivateAcl,
  validateUploadTarget,
} from './private-worker-artifact-transport.mjs';
import { runPublisher } from './publish-private-worker-artifact.mjs';
import { runRetriever } from './retrieve-private-worker-artifact.mjs';
import { verifyOfflineProvenance } from './private-worker-artifact-cli.mjs';

const roots = [];
const originalRunnerTemp = process.env.RUNNER_TEMP;
beforeEach(async () => {
  const runnerTemp = await mkdtemp(path.join(tmpdir(), 'private-worker-runner-temp-'));
  await chmod(runnerTemp, 0o700);
  roots.push(runnerTemp);
  process.env.RUNNER_TEMP = runnerTemp;
});
afterEach(async () => {
  if (originalRunnerTemp === undefined) delete process.env.RUNNER_TEMP;
  else process.env.RUNNER_TEMP = originalRunnerTemp;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const bucketId = 'bucket_identifier_123';
const bucketName = 'notification-worker-private';
const denialBucketName = 'notification-worker-denied-canary';
const region = 'us-west-004';
const sourceCommit = 'a'.repeat(40);
const archiveDigest = sha256Bytes(Buffer.from('archive'));
const prefix = `notification-worker/v1/${sourceCommit}/${archiveDigest}/`;
const capabilities = ['writeFiles', 'readFiles', 'readBuckets'];
const apiOrigin = 'https://api004.backblazeb2.com';
const downloadOrigin = 'https://f004.backblazeb2.com';
const s3Origin = `https://s3.${region}.backblazeb2.com`;

function receiptFields() {
  return {
    schemaVersion: 1,
    disabled: true,
    credentialFree: true,
    activationAuthorized: false,
    repository: 'NikolasP98/minion_hub',
    sourceCommit,
    sourceTree: 'c'.repeat(40),
    lockSha256: `sha256:${'d'.repeat(64)}`,
    workflow: '.github/workflows/notification-worker-private-publish.yml',
    workflowCommit: 'e'.repeat(40),
    workflowSourceCommit: 'f'.repeat(40),
    sourceRef: 'refs/heads/master',
    runId: '100',
    runAttempt: '1',
    builderImage: `node@sha256:${'1'.repeat(64)}`,
    dependencyImage: `bun@sha256:${'2'.repeat(64)}`,
    dependencyVersion: '1.3.1',
    nodeVersion: 'v22.20.0',
    nodeAbi: '127',
    translationPluginSha256: `sha256:${'3'.repeat(64)}`,
    bucketId,
    bucketName,
    denialBucketName,
    region,
    prefix,
    apiOrigin,
    downloadOrigin,
    s3Origin,
  };
}

function authority() {
  return {
    bucketId,
    bucketName,
    denialBucketName,
    prefix,
    region,
    ownerId: 'owner-canonical',
    repository: 'NikolasP98/minion_hub',
    sourceCommit,
    sourceTree: 'c'.repeat(40),
    lockSha256: `sha256:${'d'.repeat(64)}`,
    workflow: '.github/workflows/notification-worker-private-publish.yml',
    workflowCommit: 'e'.repeat(40),
    workflowSourceCommit: 'f'.repeat(40),
    sourceRef: 'refs/heads/master',
    runId: '100',
    runAttempt: '1',
    builderImage: `node@sha256:${'1'.repeat(64)}`,
    dependencyImage: `bun@sha256:${'2'.repeat(64)}`,
    dependencyVersion: '1.3.1',
    nodeVersion: 'v22.20.0',
    nodeAbi: '127',
    translationPluginSha256: `sha256:${'3'.repeat(64)}`,
    archiveSha256: archiveDigest,
    manifestSha256: sha256Bytes(Buffer.from('{}\n')),
    provenanceSha256: sha256Bytes(Buffer.from('{}\n')),
    apiOrigin,
    downloadOrigin,
    s3Origin,
  };
}

function authorizeResponse(caps = capabilities, allowedPrefix = prefix) {
  return {
    accountId: 'account',
    applicationKeyExpirationTimestamp: null,
    authorizationToken: 'native-token',
    apiInfo: {
      storageApi: {
        absoluteMinimumPartSize: 5000000,
        recommendedPartSize: 100000000,
        apiUrl: 'https://api004.backblazeb2.com/',
        downloadUrl: 'https://f004.backblazeb2.com/',
        s3ApiUrl: `https://s3.${region}.backblazeb2.com/`,
        allowed: {
          buckets: [{ id: bucketId, name: bucketName }],
          capabilities: caps,
          namePrefix: allowedPrefix,
        },
      },
    },
  };
}

function privateAcl(owner = 'owner-canonical') {
  return `<?xml version="1.0"?><AccessControlPolicy xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Owner><ID>${owner}</ID><DisplayName></DisplayName></Owner><AccessControlList><Grant><Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="CanonicalUser"><ID>${owner}</ID><DisplayName></DisplayName></Grantee><Permission>FULL_CONTROL</Permission></Grant></AccessControlList></AccessControlPolicy>`;
}

function fakeB2({
  failUploadNumber = 0,
  failDownloadNumber = 0,
  corruptDownloadNumber = 0,
  downloadMode = 'stored',
  caps = capabilities,
  allowedPrefix = prefix,
} = {}) {
  const objects = new Map();
  const calls = [];
  let uploads = 0;
  let downloads = 0;
  const fetch = async (input, options = {}) => {
    const url = String(input);
    calls.push({ url, method: options.method ?? 'GET', headers: options.headers });
    if (url === 'https://api.backblazeb2.com/b2api/v4/b2_authorize_account')
      return Response.json(authorizeResponse(caps, allowedPrefix));
    if (url === `https://s3.${region}.backblazeb2.com/${bucketName}?acl`)
      return new Response(privateAcl(), {
        headers: { 'content-length': String(privateAcl().length) },
      });
    if (url === `https://s3.${region}.backblazeb2.com/${denialBucketName}?acl`)
      return new Response('denied', { status: 403 });
    if (url.startsWith('https://api004.backblazeb2.com/b2api/v4/b2_get_upload_url'))
      return Response.json({
        bucketId,
        uploadUrl: `https://pod-000-1005-03.backblaze.com/b2api/v4/b2_upload_file?cvt=c001_v0001005_t0027&bucket=${bucketId}`,
        authorizationToken: 'upload-token',
      });
    if (url.startsWith('https://pod-000-1005-03.backblaze.com/')) {
      uploads += 1;
      const uploadNumber = uploads;
      if (failUploadNumber === uploadNumber) return new Response('failed', { status: 503 });
      const chunks = [];
      if (options.body?.[Symbol.asyncIterator]) {
        for await (const chunk of options.body) chunks.push(Buffer.from(chunk));
      } else chunks.push(Buffer.from(options.body));
      const bytes = Buffer.concat(chunks);
      const name = decodeURIComponent(options.headers['x-bz-file-name']);
      const fileId = `file_identifier_${String(uploadNumber).padStart(4, '0')}`;
      objects.set(fileId, { bytes, name });
      return Response.json({ bucketId, fileId, fileName: name });
    }
    if (url.startsWith('https://f004.backblazeb2.com/b2api/v4/b2_download_file_by_id')) {
      downloads += 1;
      if (failDownloadNumber === downloads) return new Response('failed', { status: 503 });
      if (downloadMode === 'redirect')
        return new Response('', {
          status: 302,
          headers: { location: 'https://evil.example/object' },
        });
      const fileId = new URL(url).searchParams.get('fileId');
      const stored = objects.get(fileId);
      if (stored && corruptDownloadNumber === downloads) {
        const bytes = Buffer.from(stored.bytes);
        bytes[0] ^= 1;
        return new Response(bytes, { headers: { 'content-length': String(bytes.length) } });
      }
      if (stored && downloadMode === 'oversize')
        return new Response(Buffer.concat([stored.bytes, Buffer.from('extra')]), {
          headers: { 'content-length': String(stored.bytes.length + 5) },
        });
      return stored
        ? new Response(stored.bytes, { headers: { 'content-length': String(stored.bytes.length) } })
        : new Response('missing', { status: 404 });
    }
    throw new Error(`unexpected_request:${url}`);
  };
  return { fetch, calls, objects };
}

function client(fake, caps = capabilities, expectedPrefix = prefix) {
  return createB2Client(
    {
      bucketId,
      bucketName,
      denialBucketName,
      prefix: expectedPrefix,
      region,
      capabilities: caps,
      ownerId: 'owner-canonical',
      apiOrigin,
      downloadOrigin,
      s3Origin,
    },
    fake.fetch,
  );
}

async function validArtifactFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'private-worker-valid-artifact-'));
  roots.push(directory);
  const payload = path.join(directory, 'payload');
  const output = path.join(directory, 'output');
  await mkdir(path.join(payload, 'build'), { recursive: true });
  await mkdir(path.join(payload, 'ops'), { recursive: true });
  await writeFile(path.join(payload, 'build/index.js'), 'export {};\n');
  for (const [source, target] of [
    [
      'deploy/systemd/minion-hub-notification-worker.service',
      'minion-hub-notification-worker.service',
    ],
    [
      'deploy/systemd/minion-hub-notification-worker-launcher',
      'minion-hub-notification-worker-launcher',
    ],
    ['scripts/ops/verify-disabled-worker.sh', 'verify-disabled-worker.sh'],
  ])
    await writeFile(path.join(payload, 'ops', target), await readFile(source));
  const fixtureSource = 'a'.repeat(40);
  const run = spawnSync(
    'node',
    [
      'scripts/ops/build-notification-worker-artifact.mjs',
      `--output=${output}`,
      '--repository=NikolasP98/minion_hub',
      '--workflow=.github/workflows/notification-worker-private-publish.yml',
      `--workflow-commit=${'d'.repeat(40)}`,
      `--workflow-source-commit=${'e'.repeat(40)}`,
      '--run-id=100',
      '--run-attempt=1',
      `--source-commit=${fixtureSource}`,
      `--source-tree=${'b'.repeat(40)}`,
      `--builder-image=node@sha256:${'1'.repeat(64)}`,
      `--dependency-image=bun@sha256:${'2'.repeat(64)}`,
      `--translation-plugin-sha256=sha256:${'3'.repeat(64)}`,
      '--bun-version=1.3.1',
      `--target-node-version=${process.version}`,
      `--target-node-abi=${process.versions.modules}`,
      `--payload-dir=${payload}`,
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, MINION_ARTIFACT_TEST: '1', MINION_PINNED_BUILDER: '1' },
    },
  );
  assert.equal(run.status, 0, run.stderr);
  return {
    directory,
    archive: path.join(output, 'minion-hub-notification-worker.tar'),
    manifest: path.join(output, 'manifest.json'),
    sourceCommit: fixtureSource,
  };
}

test('freezes exact Native and S3 authority surfaces', async () => {
  assert.equal(
    validateAuthorizeResponse(authorizeResponse(), {
      bucketId,
      bucketName,
      prefix,
      region,
      capabilities,
      apiOrigin,
      downloadOrigin,
      s3Origin,
    }).authorizationToken,
    'native-token',
  );
  assert.throws(
    () =>
      validateAuthorizeResponse(authorizeResponse([...capabilities, 'deleteFiles']), {
        bucketId,
        bucketName,
        prefix,
        region,
        capabilities,
        apiOrigin,
        downloadOrigin,
        s3Origin,
      }),
    /authorize_capabilities/,
  );
  const partnerAuthority = authorizeResponse();
  partnerAuthority.apiInfo.groupsApi = { capabilities: ['writeGroups'] };
  assert.throws(
    () =>
      validateAuthorizeResponse(partnerAuthority, {
        bucketId,
        bucketName,
        prefix,
        region,
        capabilities,
        apiOrigin,
        downloadOrigin,
        s3Origin,
      }),
    /authorize_apiInfo_keys/,
  );
  assert.throws(
    () =>
      validatePrivateAcl(
        privateAcl().replace(
          '<Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="CanonicalUser"><ID>owner-canonical</ID><DisplayName></DisplayName></Grantee>',
          '<Grantee><DisplayName>x</DisplayName></Grantee><Foo xsi:type="CanonicalUser"><ID>owner-canonical</ID></Foo>',
        ),
        'owner-canonical',
      ),
    /acl_structure|acl_public_or_foreign/,
  );
  const valid = {
    bucketId,
    uploadUrl: `https://pod-000-1005-03.backblaze.com/b2api/v4/b2_upload_file?cvt=c001_v1&bucket=${bucketId}`,
    authorizationToken: 'upload-token',
  };
  assert.equal(validateUploadTarget(valid, { bucketId }).bucketId, bucketId);
  for (const uploadUrl of [
    `https://pod-000-1005-03.backblaze.com/b2api/v4/b2_upload_file/${bucketId}/token`,
    `https://pod-000-1005-03.backblaze.com/b2api/v4/b2_upload_file?cvt=x&bucket=${bucketId}&extra=1`,
    `https://pod-000-1005-03.backblaze.com/b2api/v4/b2_upload_file?cvt=x&cvt=y&bucket=${bucketId}`,
    `https://pod-000-1005-03.backblaze.com/b2api/v4/b2_upload_file?cvt=%2F&bucket=${bucketId}`,
    `https://evil.example/b2api/v4/b2_upload_file?cvt=x&bucket=${bucketId}`,
  ])
    assert.throws(() => validateUploadTarget({ ...valid, uploadUrl }, { bucketId }));
  validatePrivateAcl(privateAcl(), 'owner-canonical');
  assert.throws(
    () =>
      validatePrivateAcl(
        privateAcl().replace('</Grant>', '<Grantee><URI>AllUsers</URI></Grantee></Grant>'),
        'owner-canonical',
      ),
    /acl_public_or_foreign|acl_structure/,
  );
  assert.throws(() => validatePrivateAcl(privateAcl('foreign'), 'owner-canonical'), /acl_owner/);
});

test('streams files through exact-ID reread and semantic verification before receipt', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'private-worker-stream-'));
  roots.push(root);
  const paths = {
    archive: path.join(root, 'worker.tar'),
    manifest: path.join(root, 'manifest.json'),
    provenance: path.join(root, 'attestation.jsonl'),
  };
  await Promise.all([
    writeFile(paths.archive, 'archive'),
    writeFile(paths.manifest, '{}\n'),
    writeFile(paths.provenance, '{}\n'),
  ]);
  const fake = fakeB2();
  const b2 = client(fake);
  const auth = await b2.authorize('publisher-key', 'publisher-secret');
  let verified = false;
  const result = await publishPrivateArtifactFiles({
    client: b2,
    auth,
    files: Object.fromEntries(
      Object.entries(paths).map(([name, file]) => [
        name,
        { path: file, fileName: path.basename(file), maximum: 1024 },
      ]),
    ),
    receiptFields: receiptFields(),
    verifyDownloaded: async (files) => {
      assert.equal(await readFile(files.archive, 'utf8'), 'archive');
      assert.equal(await readFile(files.manifest, 'utf8'), '{}\n');
      verified = true;
    },
  });
  assert.equal(verified, true);
  assert.match(result.receiptFileId, /^file_identifier_/);
  assert.equal([...fake.objects.values()].at(-1).name, `${prefix}publication-receipt.json`);
});

test('publisher CLI core stages immutable inputs and uses only external authority', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'private-worker-cli-'));
  roots.push(root);
  const authorityFile = path.join(root, 'authority.json');
  await writeFile(authorityFile, `${JSON.stringify(authority())}\n`, { mode: 0o400 });
  await chmod(root, 0o700);
  const files = {
    archive: path.join(root, 'worker.tar'),
    manifest: path.join(root, 'manifest.json'),
    provenance: path.join(root, 'attestation.jsonl'),
  };
  await Promise.all([
    writeFile(files.archive, 'archive'),
    writeFile(files.manifest, '{}\n'),
    writeFile(files.provenance, '{}\n'),
  ]);
  const fake = fakeB2();
  const oldRunnerTemp = process.env.RUNNER_TEMP;
  process.env.RUNNER_TEMP = root;
  const result = await runPublisher(
    [
      `--authority=${authorityFile}`,
      `--archive=${files.archive}`,
      `--manifest=${files.manifest}`,
      `--provenance=${files.provenance}`,
    ],
    {
      secrets: () => ({
        keyId: 'CANARY_KEY_ID_DO_NOT_LOG',
        applicationKey: 'CANARY_SECRET_DO_NOT_LOG',
      }),
      b2FromAuthority: (value, caps) => client(fake, caps),
      verifyBundle: async (staged, external) => {
        assert.notEqual(staged.archive.path, files.archive);
        assert.equal(await readFile(staged.archive.path, 'utf8'), 'archive');
        assert.equal(external.archiveSha256, archiveDigest);
        return { archiveSha256: archiveDigest };
      },
    },
  ).finally(() => {
    if (oldRunnerTemp === undefined) delete process.env.RUNNER_TEMP;
    else process.env.RUNNER_TEMP = oldRunnerTemp;
  });
  assert.match(result.receiptFileId, /^file_identifier_/);
  assert.doesNotMatch(JSON.stringify(result), /CANARY_|customer|provider/i);
});

test('publisher rejects unsafe temporary parents before credentials or transport', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'private-worker-unsafe-temp-'));
  roots.push(root);
  await chmod(root, 0o700);
  const authorityFile = path.join(root, 'authority.json');
  const files = {
    archive: path.join(root, 'worker.tar'),
    manifest: path.join(root, 'manifest.json'),
    provenance: path.join(root, 'attestation.jsonl'),
  };
  await Promise.all([
    writeFile(authorityFile, `${JSON.stringify(authority())}\n`, { mode: 0o400 }),
    writeFile(files.archive, 'archive'),
    writeFile(files.manifest, '{}\n'),
    writeFile(files.provenance, '{}\n'),
  ]);
  const canonicalParent = path.join(root, 'canonical-parent');
  const linkedParent = path.join(root, 'linked-parent');
  const writableParent = path.join(root, 'writable-parent');
  await mkdir(canonicalParent, { mode: 0o700 });
  await symlink(canonicalParent, linkedParent);
  await mkdir(writableParent, { mode: 0o777 });
  await chmod(writableParent, 0o777);
  let credentialCalls = 0;
  let transportCalls = 0;
  let verifierCalls = 0;
  const dependencies = {
    secrets: () => {
      credentialCalls += 1;
      return { keyId: 'CANARY_KEY', applicationKey: 'CANARY_SECRET' };
    },
    b2FromAuthority: () => {
      transportCalls += 1;
      throw new Error('transport_must_not_run');
    },
    verifyBundle: async () => {
      verifierCalls += 1;
      return { archiveSha256: archiveDigest };
    },
  };
  const argv = [
    `--authority=${authorityFile}`,
    `--archive=${files.archive}`,
    `--manifest=${files.manifest}`,
    `--provenance=${files.provenance}`,
  ];
  for (const unsafeParent of [linkedParent, writableParent]) {
    process.env.RUNNER_TEMP = unsafeParent;
    await assert.rejects(runPublisher(argv, dependencies), /input_parent_authority/);
  }
  assert.equal(credentialCalls, 0);
  assert.equal(transportCalls, 0);
  assert.equal(verifierCalls, 0);
});

test('real valid artifact runs through publisher, exact transport and retriever semantic verification', async () => {
  const built = await validArtifactFixture();
  const manifest = JSON.parse(await readFile(built.manifest, 'utf8'));
  const provenance = path.join(built.directory, 'attestation.jsonl');
  await writeFile(provenance, '{}\n');
  const fakeBin = path.join(built.directory, 'bin');
  await mkdir(fakeBin);
  await writeFile(
    path.join(fakeBin, 'gh'),
    '#!/bin/sh\nfor required in --signer-workflow --source-ref --source-digest --signer-digest --deny-self-hosted-runners; do case " $* " in *" $required "*) :;; *) exit 9;; esac; done\nprev=; bundle=; for arg in "$@"; do test "$prev" = --bundle && bundle=$arg; prev=$arg; done; test -n "$bundle" || exit 9; grep -q INVALID "$bundle" && exit 8; exit 0\n',
    { mode: 0o500 },
  );
  const external = {
    bucketId,
    bucketName,
    denialBucketName,
    prefix: `notification-worker/v1/${manifest.sourceCommit}/${manifest.archiveSha256}/`,
    region,
    ownerId: 'owner-canonical',
    repository: manifest.repository,
    sourceCommit: manifest.sourceCommit,
    sourceTree: manifest.sourceTree,
    lockSha256: manifest.lockSha256,
    workflow: manifest.workflow,
    workflowCommit: manifest.workflowCommit,
    workflowSourceCommit: manifest.workflowSourceCommit,
    sourceRef: 'refs/heads/master',
    runId: manifest.runId,
    runAttempt: manifest.runAttempt,
    builderImage: manifest.builderImage,
    dependencyImage: manifest.dependencyImage,
    dependencyVersion: manifest.bunVersion,
    nodeVersion: manifest.nodeVersion,
    nodeAbi: manifest.nodeAbi,
    translationPluginSha256: manifest.translationPluginSha256,
    archiveSha256: manifest.archiveSha256,
    manifestSha256: sha256Bytes(await readFile(built.manifest)),
    provenanceSha256: sha256Bytes(await readFile(provenance)),
    apiOrigin,
    downloadOrigin,
    s3Origin,
  };
  const authorityFile = path.join(built.directory, 'authority.json');
  await writeFile(authorityFile, `${JSON.stringify(external)}\n`, { mode: 0o400 });
  const staging = path.join(built.directory, 'staging');
  await mkdir(staging, { mode: 0o700 });
  const fake = fakeB2({ allowedPrefix: external.prefix });
  const b2 = client(fake, capabilities, external.prefix);
  const oldPath = process.env.PATH;
  const oldRunnerTemp = process.env.RUNNER_TEMP;
  process.env.PATH = `${fakeBin}:${oldPath}`;
  process.env.RUNNER_TEMP = built.directory;
  try {
    const cliArguments = [
      `--authority=${authorityFile}`,
      `--archive=${built.archive}`,
      `--manifest=${built.manifest}`,
      `--provenance=${provenance}`,
    ];
    const malformedProvider = path.join(built.directory, 'malformed-provider.mjs');
    await writeFile(
      malformedProvider,
      "globalThis.fetch=async()=>new Response('PROVIDER_RESPONSE_CANARY_SECRET');\n",
    );
    const malformedRun = spawnSync(
      'node',
      [
        '--import',
        malformedProvider,
        'scripts/ops/publish-private-worker-artifact.mjs',
        ...cliArguments,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          WORKER_ARTIFACT_B2_PUBLISHER_KEY_ID: 'CREDENTIAL_KEY_CANARY',
          WORKER_ARTIFACT_B2_PUBLISHER_APPLICATION_KEY: 'CREDENTIAL_SECRET_CANARY',
        },
      },
    );
    assert.notEqual(malformedRun.status, 0);
    assert.equal(malformedRun.stdout, '');
    assert.equal(malformedRun.stderr, 'private_worker_publish_failed\n');
    assert.doesNotMatch(
      `${malformedRun.stdout}${malformedRun.stderr}`,
      /CANARY|PROVIDER|CREDENTIAL/,
    );
    const maliciousUrlProvider = path.join(built.directory, 'malicious-url-provider.mjs');
    const authorize = authorizeResponse();
    authorize.apiInfo.storageApi.allowed.namePrefix = external.prefix;
    await writeFile(
      maliciousUrlProvider,
      `const auth=${JSON.stringify(authorize)};globalThis.fetch=async(input)=>{const u=String(input);if(u.includes('b2_authorize_account'))return Response.json(auth);if(u.includes('${bucketName}?acl'))return new Response(${JSON.stringify(privateAcl())});if(u.includes('${denialBucketName}?acl'))return new Response('denied',{status:403});if(u.includes('b2_get_upload_url'))return Response.json({bucketId:${JSON.stringify(bucketId)},uploadUrl:'https://user:AUTHENTICATED_URL_CANARY@pod-000-1005-03.backblaze.com/b2api/v4/b2_upload_file?cvt=x&bucket=${bucketId}',authorizationToken:'token'});throw new Error('unexpected');};\n`,
    );
    const urlRun = spawnSync(
      'node',
      [
        '--import',
        maliciousUrlProvider,
        'scripts/ops/publish-private-worker-artifact.mjs',
        ...cliArguments,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          WORKER_ARTIFACT_B2_PUBLISHER_KEY_ID: 'CREDENTIAL_KEY_CANARY',
          WORKER_ARTIFACT_B2_PUBLISHER_APPLICATION_KEY: 'CREDENTIAL_SECRET_CANARY',
        },
      },
    );
    assert.notEqual(urlRun.status, 0);
    assert.equal(urlRun.stdout, '');
    assert.equal(urlRun.stderr, 'private_worker_publish_failed\n');
    assert.doesNotMatch(`${urlRun.stdout}${urlRun.stderr}`, /CANARY|AUTHENTICATED|CREDENTIAL/);
    const published = await runPublisher(cliArguments, {
      secrets: () => ({ keyId: 'key', applicationKey: 'secret' }),
      b2FromAuthority: () => b2,
    });
    const retrieved = await runRetriever(
      [
        `--authority=${authorityFile}`,
        `--receipt-file-id=${published.receiptFileId}`,
        `--receipt-sha256=${published.receiptSha256}`,
        `--staging-parent=${staging}`,
      ],
      {
        secrets: () => ({ keyId: 'key', applicationKey: 'secret' }),
        b2FromAuthority: () => b2,
        allowDisposableNonRoot: true,
      },
    );
    assert.equal(retrieved.sourceCommit, manifest.sourceCommit);
    const retrievedArchive = path.join(retrieved.directory, path.basename(built.archive));
    await chmod(retrievedArchive, 0o600);
    await writeFile(retrievedArchive, 'invalid', { flag: 'w' });
    await assert.rejects(
      (await import('./notification-worker-artifact-contract.mjs')).verifyArtifact({
        archive: retrievedArchive,
        manifestFile: path.join(retrieved.directory, 'manifest.json'),
        expected: { archiveSha256: manifest.archiveSha256 },
      }),
      /archive_digest|archive_shape/,
    );
    const retrievedProvenance = path.join(retrieved.directory, path.basename(provenance));
    await chmod(retrievedProvenance, 0o600);
    await writeFile(retrievedProvenance, 'INVALID\n');
    assert.throws(
      () =>
        verifyOfflineProvenance({
          archive: built.archive,
          manifest: built.manifest,
          provenance: retrievedProvenance,
          authority: external,
        }),
      /provenance_verify/,
    );
  } finally {
    process.env.PATH = oldPath;
    if (oldRunnerTemp === undefined) delete process.env.RUNNER_TEMP;
    else process.env.RUNNER_TEMP = oldRunnerTemp;
  }
});

test('streams exact receipt IDs into a new private directory and removes partial failures', async () => {
  const source = await mkdtemp(path.join(tmpdir(), 'private-worker-source-'));
  roots.push(source);
  const paths = {
    archive: path.join(source, 'worker.tar'),
    manifest: path.join(source, 'manifest.json'),
    provenance: path.join(source, 'attestation.jsonl'),
  };
  await Promise.all([
    writeFile(paths.archive, 'archive'),
    writeFile(paths.manifest, '{}\n'),
    writeFile(paths.provenance, '{}\n'),
  ]);
  const fake = fakeB2();
  const b2 = client(fake);
  const auth = await b2.authorize('key', 'secret');
  const published = await publishPrivateArtifactFiles({
    client: b2,
    auth,
    files: Object.fromEntries(
      Object.entries(paths).map(([name, file]) => [
        name,
        { path: file, fileName: path.basename(file), maximum: 1024 },
      ]),
    ),
    receiptFields: receiptFields(),
    verifyDownloaded: async () => {},
  });
  const parent = await mkdtemp(path.join(tmpdir(), 'private-worker-target-'));
  roots.push(parent);
  const directory = path.join(parent, 'release');
  let verified = false;
  const result = await retrievePrivateArtifactFiles({
    client: b2,
    auth,
    receiptFileId: published.receiptFileId,
    receiptSha256: published.receiptSha256,
    expected: { sourceCommit, bucketId },
    directory,
    verifyProvenance: async ({ archive }) => {
      assert.equal(await readFile(archive, 'utf8'), 'archive');
      verified = true;
    },
  });
  assert.equal(verified, true);
  assert.equal(result.receipt.sourceCommit, sourceCommit);
  const linked = path.join(parent, 'linked');
  await symlink(directory, linked);
  await assert.rejects(
    retrievePrivateArtifactFiles({
      client: b2,
      auth,
      receiptFileId: published.receiptFileId,
      receiptSha256: published.receiptSha256,
      expected: {},
      directory: linked,
      verifyProvenance: async () => {},
    }),
    /EEXIST/,
  );
  const failed = path.join(parent, 'failed');
  await assert.rejects(
    retrievePrivateArtifactFiles({
      client: b2,
      auth,
      receiptFileId: 'missing_file_identifier',
      receiptSha256: published.receiptSha256,
      expected: {},
      directory: failed,
      verifyProvenance: async () => {},
    }),
    /download_http_404/,
  );
  await assert.rejects(readFile(failed), /ENOENT|EISDIR/);
});

test('retriever CLI core admits only externally pinned exact IDs into private staging', async () => {
  const source = await mkdtemp(path.join(tmpdir(), 'private-worker-reader-source-'));
  const parent = await mkdtemp(path.join(tmpdir(), 'private-worker-reader-target-'));
  roots.push(source, parent);
  await chmod(parent, 0o700);
  const paths = {
    archive: path.join(source, 'worker.tar'),
    manifest: path.join(source, 'manifest.json'),
    provenance: path.join(source, 'attestation.jsonl'),
  };
  await Promise.all([
    writeFile(paths.archive, 'archive'),
    writeFile(paths.manifest, '{}\n'),
    writeFile(paths.provenance, '{}\n'),
  ]);
  const fake = fakeB2();
  const b2 = client(fake);
  const auth = await b2.authorize('key', 'secret');
  const published = await publishPrivateArtifactFiles({
    client: b2,
    auth,
    files: Object.fromEntries(
      Object.entries(paths).map(([name, file]) => [
        name,
        { path: file, fileName: path.basename(file), maximum: 1024 },
      ]),
    ),
    receiptFields: receiptFields(),
    verifyDownloaded: async () => {},
  });
  const result = await runRetriever(
    [
      '--authority=unused',
      `--receipt-file-id=${published.receiptFileId}`,
      `--receipt-sha256=${published.receiptSha256}`,
      `--staging-parent=${parent}`,
    ],
    {
      loadAuthority: async () => authority(),
      secrets: () => ({ keyId: 'key', applicationKey: 'secret' }),
      b2FromAuthority: () => b2,
      allowDisposableNonRoot: true,
      verifyArtifact: async () => {},
      verifyOfflineProvenance: () => {},
    },
  );
  assert.equal(result.sourceCommit, sourceCommit);
  assert.equal(await readFile(path.join(result.directory, 'worker.tar'), 'utf8'), 'archive');
  await assert.rejects(runRetriever(['--authority=x', '--authority=y']), /arguments_duplicate/);
  await assert.rejects(runPublisher(['--authority=x', '--unknown=y']), /arguments_unknown/);
  let credentialCalls = 0;
  let transportCalls = 0;
  await assert.rejects(
    runRetriever(
      [
        '--authority=unused',
        '--receipt-file-id=bad',
        '--receipt-sha256=bad',
        `--staging-parent=${parent}`,
      ],
      {
        loadAuthority: async () => authority(),
        secrets: () => {
          credentialCalls += 1;
          return { keyId: 'x', applicationKey: 'x' };
        },
        b2FromAuthority: () => {
          transportCalls += 1;
          return b2;
        },
        allowDisposableNonRoot: true,
      },
    ),
    /receipt_external_identity/,
  );
  assert.equal(credentialCalls, 0);
  assert.equal(transportCalls, 0);
  const linkedParent = path.join(source, 'linked-staging-parent');
  await symlink(parent, linkedParent);
  await assert.rejects(
    runRetriever(
      [
        '--authority=unused',
        `--receipt-file-id=${published.receiptFileId}`,
        `--receipt-sha256=${published.receiptSha256}`,
        `--staging-parent=${linkedParent}`,
      ],
      {
        loadAuthority: async () => authority(),
        allowDisposableNonRoot: true,
        secrets: () => ({ keyId: 'x', applicationKey: 'x' }),
        b2FromAuthority: () => b2,
      },
    ),
    /staging_parent_authority/,
  );
});

test('never emits a receipt after a payload transition fails', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'private-worker-transitions-'));
  roots.push(root);
  const paths = {
    archive: path.join(root, 'worker.tar'),
    manifest: path.join(root, 'manifest.json'),
    provenance: path.join(root, 'attestation.jsonl'),
  };
  await Promise.all([
    writeFile(paths.archive, 'archive'),
    writeFile(paths.manifest, 'manifest'),
    writeFile(paths.provenance, 'provenance'),
  ]);
  const files = Object.fromEntries(
    Object.entries(paths).map(([name, file]) => [
      name,
      { path: file, fileName: path.basename(file), maximum: 1024 },
    ]),
  );
  for (const failure of [
    { failUploadNumber: 1 },
    { failUploadNumber: 2 },
    { failUploadNumber: 3 },
    { failDownloadNumber: 1 },
    { failDownloadNumber: 2 },
    { failDownloadNumber: 3 },
  ]) {
    const fake = fakeB2(failure);
    const b2 = client(fake);
    const auth = await b2.authorize('publisher-key', 'publisher-secret');
    await assert.rejects(
      publishPrivateArtifactFiles({
        client: b2,
        auth,
        files,
        receiptFields: receiptFields(),
        verifyDownloaded: async () => {},
      }),
      /http_503/,
    );
    assert.equal(
      [...fake.objects.values()].some((entry) => entry.name.endsWith('publication-receipt.json')),
      false,
    );
  }
});

test('rejects each corrupt selected payload and semantic failure before receipt', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'private-worker-corrupt-'));
  roots.push(root);
  const paths = {
    archive: path.join(root, 'worker.tar'),
    manifest: path.join(root, 'manifest.json'),
    provenance: path.join(root, 'attestation.jsonl'),
  };
  await Promise.all([
    writeFile(paths.archive, 'archive'),
    writeFile(paths.manifest, 'manifest'),
    writeFile(paths.provenance, 'provenance'),
  ]);
  const files = Object.fromEntries(
    Object.entries(paths).map(([name, file]) => [
      name,
      { path: file, fileName: path.basename(file), maximum: 1024 },
    ]),
  );
  for (const corruptDownloadNumber of [1, 2, 3]) {
    const fake = fakeB2({ corruptDownloadNumber });
    const b2 = client(fake);
    const auth = await b2.authorize('key', 'secret');
    await assert.rejects(
      publishPrivateArtifactFiles({
        client: b2,
        auth,
        files,
        receiptFields: receiptFields(),
        verifyDownloaded: async () => {},
      }),
      /verify_/,
    );
    assert.equal(
      [...fake.objects.values()].some((entry) => entry.name.endsWith('publication-receipt.json')),
      false,
    );
  }
  const fake = fakeB2();
  const b2 = client(fake);
  const auth = await b2.authorize('key', 'secret');
  await assert.rejects(
    publishPrivateArtifactFiles({
      client: b2,
      auth,
      files,
      receiptFields: receiptFields(),
      verifyDownloaded: async () => {
        throw new Error('semantic_rejected');
      },
    }),
    /semantic_rejected/,
  );
  assert.equal(
    [...fake.objects.values()].some((entry) => entry.name.endsWith('publication-receipt.json')),
    false,
  );
});

test('concurrent same-name runs remain bound to distinct exact IDs without listing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'private-worker-concurrent-'));
  roots.push(root);
  async function filesFor(label) {
    const files = {};
    for (const name of ['archive', 'manifest', 'provenance']) {
      const file = path.join(root, `${label}-${name}`);
      await writeFile(file, name);
      files[name] = {
        path: file,
        fileName: name === 'archive' ? 'worker.tar' : `${name}.json`,
        maximum: 1024,
      };
    }
    return files;
  }
  const fake = fakeB2();
  const b2 = client(fake);
  const auth = await b2.authorize('key', 'secret');
  const [one, two] = await Promise.all(
    [filesFor('one'), filesFor('two')].map(async (files) =>
      publishPrivateArtifactFiles({
        client: b2,
        auth,
        files: await files,
        receiptFields: receiptFields(),
        verifyDownloaded: async () => {},
      }),
    ),
  );
  assert.notEqual(one.receiptFileId, two.receiptFileId);
  assert.notEqual(one.receipt.archive.fileId, two.receipt.archive.fileId);
  fake.objects.set('newest_hidden_or_corrupt_version', {
    name: `${prefix}worker.tar`,
    bytes: Buffer.from('corrupt-newest'),
    hidden: true,
  });
  let selectedArchive;
  await retrievePrivateArtifactFiles({
    client: b2,
    auth,
    receiptFileId: one.receiptFileId,
    receiptSha256: one.receiptSha256,
    expected: { sourceCommit },
    directory: path.join(root, 'selected'),
    verifyProvenance: async ({ archive }) => {
      selectedArchive = await readFile(archive, 'utf8');
    },
  });
  assert.equal(selectedArchive, 'archive');
  assert.equal(
    fake.calls.some((call) => /list|fileName/.test(call.url)),
    false,
  );
});

test('rejects noncanonical or self-authorizing receipts', () => {
  const ref = {
    fileId: 'file_identifier_0001',
    fileName: 'worker.tar',
    size: 7,
    sha256: archiveDigest,
  };
  const receipt = {
    ...receiptFields(),
    archive: ref,
    manifest: { ...ref, fileId: 'file_identifier_0002', fileName: 'manifest.json' },
    provenance: { ...ref, fileId: 'file_identifier_0003', fileName: 'attestation.jsonl' },
  };
  const canonical = canonicalReceiptBytes(receipt);
  assert.equal(parseCanonicalReceipt(canonical, { bucketId }).bucketId, bucketId);
  assert.throws(
    () => parseCanonicalReceipt(Buffer.from(JSON.stringify(receipt))),
    /receipt_noncanonical|receipt_encoding/,
  );
  assert.throws(() => canonicalReceiptBytes({ ...receipt, receiptFileId: 'self' }), /receipt_keys/);
  assert.throws(
    () => parseCanonicalReceipt(canonical, { bucketId: 'other_bucket' }),
    /expected_bucketId/,
  );
});

test('rejects redirects and oversized exact-ID responses before receipt admission', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'private-worker-bad-download-'));
  roots.push(root);
  const paths = {
    archive: path.join(root, 'worker.tar'),
    manifest: path.join(root, 'manifest.json'),
    provenance: path.join(root, 'attestation.jsonl'),
  };
  await Promise.all([
    writeFile(paths.archive, 'archive'),
    writeFile(paths.manifest, 'manifest'),
    writeFile(paths.provenance, 'provenance'),
  ]);
  const files = Object.fromEntries(
    Object.entries(paths).map(([name, file]) => [
      name,
      { path: file, fileName: path.basename(file), maximum: 1024 },
    ]),
  );
  for (const downloadMode of ['redirect', 'oversize']) {
    const fake = fakeB2({ downloadMode });
    const b2 = client(fake);
    const auth = await b2.authorize('key', 'secret');
    await assert.rejects(
      publishPrivateArtifactFiles({
        client: b2,
        auth,
        files,
        receiptFields: receiptFields(),
        verifyDownloaded: async () => {},
      }),
      downloadMode === 'redirect' ? /download_http_302/ : /verify_archive/,
    );
    assert.equal(
      [...fake.objects.values()].some((entry) => entry.name.endsWith('publication-receipt.json')),
      false,
    );
  }
});

test('bounds stalled upload/download connects and cleans exclusive target failures', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'private-worker-timeout-'));
  roots.push(root);
  const source = path.join(root, 'worker.tar');
  await writeFile(source, 'archive');
  const stalledFetch = async (input, options = {}) => {
    if (String(input).includes('b2_get_upload_url'))
      return Response.json({
        bucketId,
        uploadUrl: `https://pod-000-1005-03.backblaze.com/b2api/v4/b2_upload_file?cvt=token&bucket=${bucketId}`,
        authorizationToken: 'upload-token',
      });
    return new Promise((resolve, reject) =>
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }),
    );
  };
  const timed = createB2Client(
    {
      bucketId,
      bucketName,
      denialBucketName,
      prefix,
      region,
      capabilities,
      ownerId: 'owner-canonical',
      apiOrigin,
      downloadOrigin,
      s3Origin,
      timeouts: { connect: 10, inactivity: 10, overall: 30 },
    },
    stalledFetch,
  );
  await assert.rejects(
    timed.uploadFile(authorizeResponse(), `${prefix}worker.tar`, source, 1024),
    /upload_connect_timeout|upload_overall_timeout/,
  );
  const target = path.join(root, 'download');
  await assert.rejects(
    timed.downloadFile(authorizeResponse(), 'file_identifier_missing', target, 1024),
    /download_connect_timeout|download_overall_timeout/,
  );
  await assert.rejects(readFile(target), /ENOENT/);
  await writeFile(target, 'occupied');
  let cancelled = false;
  const responsive = createB2Client(
    {
      bucketId,
      bucketName,
      denialBucketName,
      prefix,
      region,
      capabilities,
      ownerId: 'owner-canonical',
      apiOrigin,
      downloadOrigin,
      s3Origin,
      timeouts: { connect: 10, inactivity: 10, overall: 30 },
    },
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(Buffer.from('bytes'));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  );
  await assert.rejects(
    responsive.downloadFile(authorizeResponse(), 'file_identifier_missing', target, 1024),
    /EEXIST/,
  );
  assert.equal(await readFile(target, 'utf8'), 'occupied');
  assert.equal(cancelled, true);
  for (const [label, timeouts] of [
    ['inactivity', { connect: 10, inactivity: 10, overall: 50 }],
    ['overall', { connect: 10, inactivity: 50, overall: 15 }],
  ]) {
    const stalledBody = async (input, options) =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(Buffer.from('x'));
            options.signal.addEventListener(
              'abort',
              () => controller.error(options.signal.reason),
              { once: true },
            );
          },
        }),
      );
    const bounded = createB2Client(
      {
        bucketId,
        bucketName,
        denialBucketName,
        prefix,
        region,
        capabilities,
        ownerId: 'owner-canonical',
        apiOrigin,
        downloadOrigin,
        s3Origin,
        timeouts,
      },
      stalledBody,
    );
    const stalledTarget = path.join(root, label);
    await assert.rejects(
      bounded.downloadFile(authorizeResponse(), 'file_identifier_missing', stalledTarget, 1024),
      new RegExp(`download_${label}_timeout`),
    );
    await assert.rejects(readFile(stalledTarget), /ENOENT/);
  }
});

test('streams a page-filled large fixture with bounded chunks instead of archive-sized buffers', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'private-worker-large-stream-'));
  roots.push(root);
  const source = path.join(root, 'large.tar');
  const handle = await open(source, 'wx', 0o400);
  const pageBatch = Buffer.alloc(1024 * 1024, 0x5a);
  try {
    for (let index = 0; index < 32; index += 1) await handle.writeFile(pageBatch);
    await handle.sync();
  } finally {
    await handle.close();
  }
  let maximumUploadChunk = 0;
  let uploaded = 0;
  const largeFetch = async (input, options = {}) => {
    const url = String(input);
    if (url.includes('b2_get_upload_url'))
      return Response.json({
        bucketId,
        uploadUrl: `https://pod-000-1005-03.backblaze.com/b2api/v4/b2_upload_file?cvt=large&bucket=${bucketId}`,
        authorizationToken: 'upload-token',
      });
    if (url.includes('b2_upload_file')) {
      for await (const chunk of options.body) {
        maximumUploadChunk = Math.max(maximumUploadChunk, chunk.length);
        uploaded += chunk.length;
      }
      return Response.json({
        bucketId,
        fileId: 'large_file_identifier_0001',
        fileName: decodeURIComponent(options.headers['x-bz-file-name']),
      });
    }
    if (url.includes('b2_download_file_by_id')) {
      let remaining = 32 * 1024 * 1024;
      return new Response(
        new ReadableStream({
          pull(controller) {
            if (!remaining) return controller.close();
            const size = Math.min(256 * 1024, remaining);
            remaining -= size;
            controller.enqueue(Buffer.alloc(size, 0x5a));
          },
        }),
        { headers: { 'content-length': String(32 * 1024 * 1024) } },
      );
    }
    throw new Error(`unexpected_large_request:${url}`);
  };
  const largeClient = createB2Client(
    {
      bucketId,
      bucketName,
      denialBucketName,
      prefix,
      region,
      capabilities,
      ownerId: 'owner-canonical',
      apiOrigin,
      downloadOrigin,
      s3Origin,
    },
    largeFetch,
  );
  const ref = await largeClient.uploadFile(
    authorizeResponse(),
    `${prefix}large.tar`,
    source,
    64 * 1024 * 1024,
  );
  assert.equal(uploaded, 32 * 1024 * 1024);
  assert.ok(maximumUploadChunk <= 1024 * 1024);
  const target = path.join(root, 'large-downloaded.tar');
  const identity = await largeClient.downloadFile(
    authorizeResponse(),
    ref.fileId,
    target,
    64 * 1024 * 1024,
  );
  assert.equal(identity.size, 32 * 1024 * 1024);
  assert.equal((await stat(target)).size, 32 * 1024 * 1024);
});
