import { createHash, createHmac } from 'node:crypto';
import { open, mkdir, rm, lstat, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  canonicalReceiptBytes,
  OBJECT_MAXIMUMS,
  parseCanonicalReceipt,
  sha256Bytes,
} from './private-worker-artifact-contract.mjs';

const AUTHORIZE = 'https://api.backblazeb2.com/b2api/v4/b2_authorize_account';
const CVT = /^[A-Za-z0-9_-]{1,256}$/;
const MAX_JSON = 1024 * 1024;

function exactKeys(value, expected, label) {
  if (!value || Array.isArray(value) || typeof value !== 'object')
    throw new Error(`${label}_object`);
  if (Object.keys(value).sort().join('\0') !== [...expected].sort().join('\0'))
    throw new Error(`${label}_keys`);
}

async function privateTemporaryDirectory(prefix) {
  const configured = process.env.RUNNER_TEMP || '/tmp';
  const parent = await realpath(configured);
  const metadata = await lstat(parent);
  if (
    parent !== path.resolve(configured) ||
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== process.geteuid?.() ||
    (metadata.mode & 0o022) !== 0
  )
    throw new Error('temporary_parent_authority');
  return mkdtemp(path.join(parent, prefix));
}

function endpoint(url, { host, path: pathname, query = '' }, label) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.hash
  )
    throw new Error(`${label}_authority`);
  if (!host.test(parsed.hostname) || parsed.pathname !== pathname || parsed.search !== query)
    throw new Error(`${label}_endpoint`);
  return parsed;
}

export function validateAuthorizeResponse(value, expected) {
  exactKeys(
    value,
    ['accountId', 'authorizationToken', 'applicationKeyExpirationTimestamp', 'apiInfo'],
    'authorize',
  );
  if (
    value.applicationKeyExpirationTimestamp !== null &&
    (!Number.isSafeInteger(value.applicationKeyExpirationTimestamp) ||
      value.applicationKeyExpirationTimestamp < 1)
  )
    throw new Error('authorize_expiration');
  exactKeys(value.apiInfo, ['storageApi'], 'authorize_apiInfo');
  const storage = value.apiInfo.storageApi;
  exactKeys(
    storage,
    [
      'absoluteMinimumPartSize',
      'recommendedPartSize',
      'apiUrl',
      'downloadUrl',
      's3ApiUrl',
      'allowed',
    ],
    'authorize_storage',
  );
  if (
    !Number.isSafeInteger(storage.absoluteMinimumPartSize) ||
    storage.absoluteMinimumPartSize < 1 ||
    !Number.isSafeInteger(storage.recommendedPartSize) ||
    storage.recommendedPartSize < storage.absoluteMinimumPartSize
  )
    throw new Error('authorize_part_sizes');
  exactKeys(storage.allowed, ['buckets', 'capabilities', 'namePrefix'], 'authorize_allowed');
  if (storage.allowed.buckets.length !== 1) throw new Error('authorize_buckets');
  exactKeys(storage.allowed.buckets[0], ['id', 'name'], 'authorize_bucket');
  if (
    storage.allowed.buckets[0].id !== expected.bucketId ||
    storage.allowed.buckets[0].name !== expected.bucketName
  )
    throw new Error('authorize_bucket');
  if (storage.allowed.namePrefix !== expected.prefix) throw new Error('authorize_prefix');
  if (
    [...storage.allowed.capabilities].sort().join('\0') !==
    [...expected.capabilities].sort().join('\0')
  )
    throw new Error('authorize_capabilities');
  endpoint(storage.apiUrl, { host: /^api\d+\.backblazeb2\.com$/, path: '/' }, 'api');
  endpoint(storage.downloadUrl, { host: /^f\d+\.backblazeb2\.com$/, path: '/' }, 'download');
  endpoint(
    storage.s3ApiUrl,
    { host: new RegExp(`^s3\\.${expected.region}\\.backblazeb2\\.com$`), path: '/' },
    's3',
  );
  if (
    new URL(storage.apiUrl).origin !== expected.apiOrigin ||
    new URL(storage.downloadUrl).origin !== expected.downloadOrigin ||
    new URL(storage.s3ApiUrl).origin !== expected.s3Origin
  )
    throw new Error('authorize_origin');
  if (typeof value.authorizationToken !== 'string' || value.authorizationToken.length < 8)
    throw new Error('authorize_token');
  return value;
}

export function validateUploadTarget(value, expected) {
  exactKeys(value, ['bucketId', 'uploadUrl', 'authorizationToken'], 'upload_target');
  if (value.bucketId !== expected.bucketId) throw new Error('upload_bucket');
  const parsed = new URL(value.uploadUrl);
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.hash
  )
    throw new Error('upload_authority');
  if (!/^pod-[0-9-]+\.backblaze\.com$/.test(parsed.hostname)) throw new Error('upload_host');
  if (parsed.pathname !== '/b2api/v4/b2_upload_file') throw new Error('upload_path');
  if ([...parsed.searchParams.keys()].sort().join('\0') !== 'bucket\0cvt')
    throw new Error('upload_query');
  if (
    parsed.searchParams.getAll('bucket').length !== 1 ||
    parsed.searchParams.get('bucket') !== expected.bucketId
  )
    throw new Error('upload_bucket_query');
  const cvt = parsed.searchParams.getAll('cvt');
  if (cvt.length !== 1 || !CVT.test(cvt[0])) throw new Error('upload_cvt');
  if (/%2f|%5c|%2e/i.test(parsed.search)) throw new Error('upload_encoding');
  return value;
}

async function boundedBytes(response, maximum, label) {
  if (!response.ok) throw new Error(`${label}_http_${response.status}`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximum) throw new Error(`${label}_oversize`);
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maximum) {
      await reader.cancel();
      throw new Error(`${label}_oversize`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, size);
}

async function jsonRequest(fetchImpl, url, options, label, maximum = MAX_JSON) {
  const response = await fetchImpl(url, {
    ...options,
    redirect: 'error',
    signal: options.signal ?? AbortSignal.timeout(15_000),
  });
  return JSON.parse((await boundedBytes(response, maximum, label)).toString('utf8'));
}

function hmac(key, data) {
  return createHmac('sha256', key).update(data).digest();
}
function hash(data) {
  return createHash('sha256').update(data).digest('hex');
}
function awsEncode(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function signS3Acl({ method = 'GET', url, keyId, applicationKey, now = new Date() }) {
  const parsed = new URL(url);
  const date = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = date.slice(0, 8);
  const region = parsed.hostname.split('.')[1];
  const payloadHash = hash('');
  const canonicalHeaders = `host:${parsed.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${date}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalQuery = [...parsed.searchParams.entries()]
    .map(([key, value]) => [awsEncode(key), awsEncode(value)])
    .sort(
      ([aKey, aValue], [bKey, bValue]) => aKey.localeCompare(bKey) || aValue.localeCompare(bValue),
    )
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  const canonical = `${method}\n${parsed.pathname}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${day}/${region}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${date}\n${scope}\n${hash(canonical)}`;
  const signing = hmac(
    hmac(hmac(hmac(`AWS4${applicationKey}`, day), region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signing).update(stringToSign).digest('hex');
  return {
    'x-amz-date': date,
    'x-amz-content-sha256': payloadHash,
    authorization: `AWS4-HMAC-SHA256 Credential=${keyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function parseBoundedXml(xml) {
  if (/<!DOCTYPE|<!ENTITY|<!--|<!\[CDATA\[/i.test(xml)) throw new Error('acl_xml');
  const source = xml.replace(/^<\?xml [^?]+\?>/, '');
  const root = { name: '#document', attributes: {}, children: [], text: '' };
  const stack = [root];
  const token = /<[^>]+>|[^<]+/g;
  let offset = 0;
  for (const match of source.matchAll(token)) {
    if (match.index !== offset) throw new Error('acl_xml');
    offset += match[0].length;
    const value = match[0];
    if (!value.startsWith('<')) {
      if (value.trim()) stack.at(-1).text += value.trim();
      continue;
    }
    if (value.startsWith('</')) {
      const name = value.slice(2, -1);
      if (stack.length < 2 || stack.at(-1).name !== name) throw new Error('acl_xml');
      stack.pop();
      continue;
    }
    if (value.startsWith('<?') || value.endsWith('/>')) throw new Error('acl_xml');
    const opening = value.slice(1, -1);
    const name = opening.match(/^[A-Za-z_:][A-Za-z0-9_.:-]*/)?.[0];
    if (!name) throw new Error('acl_xml');
    const attributes = {};
    let rest = opening.slice(name.length);
    const attribute = /^\s+([A-Za-z_:][A-Za-z0-9_.:-]*)=(?:"([^"]*)"|'([^']*)')/;
    while (rest) {
      const parsed = rest.match(attribute);
      if (!parsed || Object.hasOwn(attributes, parsed[1])) throw new Error('acl_xml');
      attributes[parsed[1]] = parsed[2] ?? parsed[3];
      rest = rest.slice(parsed[0].length);
    }
    const node = { name, attributes, children: [], text: '' };
    stack.at(-1).children.push(node);
    stack.push(node);
  }
  if (offset !== source.length || stack.length !== 1 || root.children.length !== 1)
    throw new Error('acl_xml');
  return root.children[0];
}

function exactChildren(node, names) {
  if (node.text || node.children.map((child) => child.name).join('\0') !== names.join('\0'))
    throw new Error('acl_structure');
  return node.children;
}

export function validatePrivateAcl(xml, expectedOwner) {
  if (Buffer.byteLength(xml) > 64 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error('acl_xml');
  const root = parseBoundedXml(xml);
  if (root.name !== 'AccessControlPolicy') throw new Error('acl_structure');
  if (
    Object.keys(root.attributes).length !== 1 ||
    root.attributes.xmlns !== 'http://s3.amazonaws.com/doc/2006-03-01/'
  )
    throw new Error('acl_structure');
  const [owner, list] = exactChildren(root, ['Owner', 'AccessControlList']);
  const [ownerId, ownerDisplayName] = exactChildren(owner, ['ID', 'DisplayName']);
  if (
    Object.keys(owner.attributes).length ||
    ownerId.text !== expectedOwner ||
    ownerId.children.length ||
    Object.keys(ownerId.attributes).length ||
    ownerDisplayName.children.length ||
    Object.keys(ownerDisplayName.attributes).length
  )
    throw new Error('acl_owner');
  const [grant] = exactChildren(list, ['Grant']);
  if (Object.keys(list.attributes).length || Object.keys(grant.attributes).length)
    throw new Error('acl_structure');
  const [grantee, permission] = exactChildren(grant, ['Grantee', 'Permission']);
  if (permission.text !== 'FULL_CONTROL' || permission.children.length)
    throw new Error('acl_public_or_foreign');
  const attributes = Object.entries(grantee.attributes);
  if (
    grantee.attributes['xsi:type'] !== 'CanonicalUser' ||
    attributes.some(([name]) => !['xsi:type', 'xmlns:xsi'].includes(name))
  )
    throw new Error('acl_public_or_foreign');
  if (grantee.attributes['xmlns:xsi'] !== 'http://www.w3.org/2001/XMLSchema-instance')
    throw new Error('acl_public_or_foreign');
  const [id, displayName] = exactChildren(grantee, ['ID', 'DisplayName']);
  if (
    id.text !== expectedOwner ||
    id.children.length ||
    Object.keys(id.attributes).length ||
    displayName.children.length ||
    Object.keys(displayName.attributes).length
  )
    throw new Error('acl_public_or_foreign');
}

export function createB2Client(config, fetchImpl = fetch) {
  if (
    !/^[A-Za-z0-9_-]{8,128}$/.test(config.bucketId) ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucketName) ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.denialBucketName) ||
    config.denialBucketName === config.bucketName ||
    !/^[a-z0-9-]{2,32}$/.test(config.region) ||
    !/^notification-worker\/v1\/[0-9a-f]{40}\/sha256:[0-9a-f]{64}\/$/.test(config.prefix) ||
    !/^[A-Za-z0-9_-]{3,256}$/.test(config.ownerId) ||
    !config.apiOrigin ||
    !config.downloadOrigin ||
    !config.s3Origin
  )
    throw new Error('b2_configuration');
  const timeouts = {
    connect: config.timeouts?.connect ?? 30_000,
    inactivity: config.timeouts?.inactivity ?? 30_000,
    overall: config.timeouts?.overall ?? 15 * 60_000,
  };
  if (Object.values(timeouts).some((value) => !Number.isSafeInteger(value) || value < 1))
    throw new Error('b2_timeouts');
  const expected = {
    bucketId: config.bucketId,
    bucketName: config.bucketName,
    prefix: config.prefix,
    region: config.region,
    capabilities: config.capabilities,
    apiOrigin: config.apiOrigin,
    downloadOrigin: config.downloadOrigin,
    s3Origin: config.s3Origin,
  };
  async function authorize(keyId, applicationKey) {
    const value = await jsonRequest(
      fetchImpl,
      AUTHORIZE,
      {
        headers: {
          authorization: `Basic ${Buffer.from(`${keyId}:${applicationKey}`).toString('base64')}`,
        },
      },
      'authorize',
    );
    return validateAuthorizeResponse(value, expected);
  }
  async function assertPrivate(auth, keyId, applicationKey) {
    const url = new URL(
      `${encodeURIComponent(config.bucketName)}?acl`,
      `${auth.apiInfo.storageApi.s3ApiUrl.replace(/\/$/, '')}/`,
    ).href;
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: signS3Acl({ url, keyId, applicationKey }),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    validatePrivateAcl(
      (await boundedBytes(response, 64 * 1024, 'acl')).toString('utf8'),
      config.ownerId,
    );
    const deniedUrl = new URL(
      `${encodeURIComponent(config.denialBucketName)}?acl`,
      `${auth.apiInfo.storageApi.s3ApiUrl.replace(/\/$/, '')}/`,
    ).href;
    const denied = await fetchImpl(deniedUrl, {
      method: 'GET',
      headers: signS3Acl({ url: deniedUrl, keyId, applicationKey }),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (denied.status !== 403) throw new Error('acl_other_bucket_not_denied');
    await denied.body?.cancel();
  }
  async function uploadFile(auth, fileName, file, maximum) {
    if (!fileName.startsWith(config.prefix)) throw new Error('upload_outside_prefix');
    const api = `${auth.apiInfo.storageApi.apiUrl.replace(/\/$/, '')}/`;
    const target = validateUploadTarget(
      await jsonRequest(
        fetchImpl,
        `${api}b2api/v4/b2_get_upload_url?bucketId=${encodeURIComponent(config.bucketId)}`,
        { headers: { authorization: auth.authorizationToken } },
        'get_upload',
      ),
      expected,
    );
    const handle = await open(file, 'r');
    const controller = new AbortController();
    const overall = setTimeout(
      () => controller.abort(new Error('upload_overall_timeout')),
      timeouts.overall,
    );
    let inactivity = setTimeout(
      () => controller.abort(new Error('upload_connect_timeout')),
      timeouts.connect,
    );
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size < 1 || metadata.size > maximum)
        throw new Error('upload_file_size');
      const sha1 = createHash('sha1');
      const sha256 = createHash('sha256');
      for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) {
        sha1.update(chunk);
        sha256.update(chunk);
      }
      async function* monitoredBody() {
        for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) {
          clearTimeout(inactivity);
          inactivity = setTimeout(
            () => controller.abort(new Error('upload_inactivity_timeout')),
            timeouts.inactivity,
          );
          yield chunk;
        }
      }
      const result = await jsonRequest(
        fetchImpl,
        target.uploadUrl,
        {
          method: 'POST',
          headers: {
            authorization: target.authorizationToken,
            'x-bz-file-name': encodeURIComponent(fileName),
            'x-bz-content-sha1': sha1.digest('hex'),
            'content-type': 'application/octet-stream',
            'content-length': String(metadata.size),
          },
          body: monitoredBody(),
          duplex: 'half',
          signal: controller.signal,
        },
        'upload',
      );
      if (
        result.bucketId !== config.bucketId ||
        result.fileName !== fileName ||
        typeof result.fileId !== 'string'
      )
        throw new Error('upload_response');
      return {
        fileId: result.fileId,
        fileName: path.posix.basename(fileName),
        size: metadata.size,
        sha256: `sha256:${sha256.digest('hex')}`,
      };
    } finally {
      clearTimeout(overall);
      clearTimeout(inactivity);
      await handle.close();
    }
  }
  async function downloadFile(auth, fileId, target, maximum) {
    const base = `${auth.apiInfo.storageApi.downloadUrl.replace(/\/$/, '')}/`;
    const controller = new AbortController();
    const overall = setTimeout(
      () => controller.abort(new Error('download_overall_timeout')),
      timeouts.overall,
    );
    let inactivity = setTimeout(
      () => controller.abort(new Error('download_connect_timeout')),
      timeouts.connect,
    );
    let handle;
    let reader;
    let created = false;
    let result;
    let failure;
    try {
      const response = await fetchImpl(
        `${base}b2api/v4/b2_download_file_by_id?fileId=${encodeURIComponent(fileId)}`,
        {
          headers: { authorization: auth.authorizationToken },
          redirect: 'error',
          signal: controller.signal,
        },
      );
      clearTimeout(inactivity);
      if (!response.ok) throw new Error(`download_http_${response.status}`);
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maximum) throw new Error('download_oversize');
      reader = response.body?.getReader();
      if (!reader) throw new Error('download_body');
      handle = await open(target, 'wx', 0o400);
      created = true;
      const digest = createHash('sha256');
      let size = 0;
      for (;;) {
        clearTimeout(inactivity);
        inactivity = setTimeout(
          () => controller.abort(new Error('download_inactivity_timeout')),
          timeouts.inactivity,
        );
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maximum) throw new Error('download_oversize');
        digest.update(value);
        let offset = 0;
        while (offset < value.length) offset += (await handle.write(value, offset)).bytesWritten;
      }
      await handle.sync();
      result = { size, sha256: `sha256:${digest.digest('hex')}` };
    } catch (error) {
      controller.abort(error);
      await reader?.cancel(error).catch(() => {});
      failure = error;
    } finally {
      clearTimeout(inactivity);
      clearTimeout(overall);
      await handle?.close();
    }
    if (failure) {
      if (created) await rm(target, { force: true });
      throw failure;
    }
    return result;
  }
  async function downloadFileClean(auth, fileId, target, maximum) {
    return downloadFile(auth, fileId, target, maximum);
  }
  return {
    authorize,
    assertPrivate,
    uploadFile,
    downloadFile: downloadFileClean,
  };
}

export async function publishPrivateArtifactFiles({
  client,
  auth,
  files,
  receiptFields,
  verifyDownloaded,
}) {
  const temporary = await privateTemporaryDirectory('worker-publish-');
  const refs = {};
  const downloaded = {};
  try {
    for (const name of ['archive', 'manifest', 'provenance']) {
      const value = files[name];
      refs[name] = await client.uploadFile(
        auth,
        `${receiptFields.prefix}${value.fileName}`,
        value.path,
        value.maximum,
      );
      const target = path.join(temporary, value.fileName);
      const identity = await client.downloadFile(auth, refs[name].fileId, target, value.maximum);
      if (identity.size !== refs[name].size || identity.sha256 !== refs[name].sha256)
        throw new Error(`verify_${name}`);
      downloaded[name] = target;
    }
    await verifyDownloaded(downloaded);
    const receipt = {
      ...receiptFields,
      archive: refs.archive,
      manifest: refs.manifest,
      provenance: refs.provenance,
    };
    const receiptBytes = canonicalReceiptBytes(receipt);
    const receiptPath = path.join(temporary, 'publication-receipt.json');
    await writeFile(receiptPath, receiptBytes, { mode: 0o400, flag: 'wx' });
    const reference = await client.uploadFile(
      auth,
      `${receiptFields.prefix}publication-receipt.json`,
      receiptPath,
      256 * 1024,
    );
    const checkedReceipt = path.join(temporary, 'checked-receipt.json');
    const identity = await client.downloadFile(auth, reference.fileId, checkedReceipt, 256 * 1024);
    if (identity.sha256 !== sha256Bytes(receiptBytes)) throw new Error('verify_receipt');
    return { receipt, receiptFileId: reference.fileId, receiptSha256: identity.sha256 };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function retrievePrivateArtifactFiles({
  client,
  auth,
  receiptFileId,
  receiptSha256,
  expected,
  directory,
  verifyProvenance,
}) {
  let created = false;
  try {
    await mkdir(directory, { recursive: false, mode: 0o700 });
    created = true;
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('staging_directory');
    const receiptPath = path.join(directory, 'publication-receipt.json');
    const receiptIdentity = await client.downloadFile(auth, receiptFileId, receiptPath, 256 * 1024);
    if (receiptIdentity.sha256 !== receiptSha256) throw new Error('receipt_digest');
    const receipt = parseCanonicalReceipt(
      await open(receiptPath, 'r').then(async (handle) => {
        try {
          return await handle.readFile();
        } finally {
          await handle.close();
        }
      }),
      expected,
    );
    const files = {};
    for (const name of ['archive', 'manifest', 'provenance']) {
      const target = path.join(directory, receipt[name].fileName);
      const identity = await client.downloadFile(
        auth,
        receipt[name].fileId,
        target,
        OBJECT_MAXIMUMS[name],
      );
      if (identity.size !== receipt[name].size || identity.sha256 !== receipt[name].sha256)
        throw new Error(`${name}_identity`);
      files[name] = target;
    }
    await verifyProvenance({ receipt, ...files });
    await rm(receiptPath, { force: true });
    return { receipt, files };
  } catch (error) {
    if (created) await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
