import { createHash } from 'node:crypto';

export const RECEIPT_SCHEMA = 1;
export const SHA256 = /^sha256:[0-9a-f]{64}$/;
export const COMMIT = /^[0-9a-f]{40}$/;
export const FILE_ID = /^[A-Za-z0-9_-]{16,512}$/;
export const B2_ID = /^[A-Za-z0-9_-]{8,128}$/;
export const OBJECT_MAXIMUMS = Object.freeze({
  archive: 1024 * 1024 * 1024,
  manifest: 4 * 1024 * 1024,
  provenance: 16 * 1024 * 1024,
});

function record(value, error) {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(error);
  return value;
}

export function exactKeys(value, expected, error = 'receipt_keys') {
  const actual = Object.keys(record(value, error)).sort();
  if (actual.join('\0') !== [...expected].sort().join('\0')) throw new Error(error);
}

function nonempty(value, field, maximum = 1024) {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum)
    throw new Error(`receipt_${field}`);
  return value;
}

function digest(value, field) {
  if (!SHA256.test(value)) throw new Error(`receipt_${field}`);
  return value;
}

function commit(value, field) {
  if (!COMMIT.test(value)) throw new Error(`receipt_${field}`);
  return value;
}

function positiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`receipt_${field}`);
  return value;
}

function objectRef(value, label) {
  exactKeys(value, ['fileId', 'fileName', 'size', 'sha256'], `receipt_${label}_keys`);
  if (!FILE_ID.test(value.fileId)) throw new Error(`receipt_${label}_fileId`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(value.fileName))
    throw new Error(`receipt_${label}_fileName`);
  positiveInteger(value.size, `${label}_size`);
  if (value.size < 1 || value.size > OBJECT_MAXIMUMS[label])
    throw new Error(`receipt_${label}_size`);
  digest(value.sha256, `${label}_sha256`);
  return { ...value };
}

export function validatePublicationReceipt(value, expected = {}) {
  exactKeys(value, [
    'schemaVersion',
    'disabled',
    'credentialFree',
    'activationAuthorized',
    'repository',
    'sourceCommit',
    'sourceTree',
    'lockSha256',
    'workflow',
    'workflowCommit',
    'workflowSourceCommit',
    'sourceRef',
    'runId',
    'runAttempt',
    'builderImage',
    'dependencyImage',
    'dependencyVersion',
    'nodeVersion',
    'nodeAbi',
    'translationPluginSha256',
    'bucketId',
    'bucketName',
    'denialBucketName',
    'region',
    'prefix',
    'apiOrigin',
    'downloadOrigin',
    's3Origin',
    'archive',
    'manifest',
    'provenance',
  ]);
  if (value.schemaVersion !== RECEIPT_SCHEMA) throw new Error('receipt_schemaVersion');
  if (
    value.disabled !== true ||
    value.credentialFree !== true ||
    value.activationAuthorized !== false
  )
    throw new Error('receipt_activation_boundary');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repository))
    throw new Error('receipt_repository');
  commit(value.sourceCommit, 'sourceCommit');
  commit(value.sourceTree, 'sourceTree');
  commit(value.workflowCommit, 'workflowCommit');
  commit(value.workflowSourceCommit, 'workflowSourceCommit');
  if (!/^refs\/heads\/[A-Za-z0-9._/-]+$/.test(value.sourceRef))
    throw new Error('receipt_sourceRef');
  digest(value.lockSha256, 'lockSha256');
  digest(value.translationPluginSha256, 'translationPluginSha256');
  nonempty(value.workflow, 'workflow');
  nonempty(value.runId, 'runId');
  nonempty(value.runAttempt, 'runAttempt');
  nonempty(value.builderImage, 'builderImage');
  nonempty(value.dependencyImage, 'dependencyImage');
  nonempty(value.dependencyVersion, 'dependencyVersion');
  nonempty(value.nodeVersion, 'nodeVersion');
  nonempty(value.nodeAbi, 'nodeAbi');
  if (!B2_ID.test(value.bucketId)) throw new Error('receipt_bucketId');
  nonempty(value.bucketName, 'bucketName', 63);
  nonempty(value.denialBucketName, 'denialBucketName', 63);
  if (value.denialBucketName === value.bucketName) throw new Error('receipt_denialBucketName');
  if (!/^[a-z0-9-]{2,32}$/.test(value.region)) throw new Error('receipt_region');
  if (!/^notification-worker\/v1\/[0-9a-f]{40}\/sha256:[0-9a-f]{64}\/$/.test(value.prefix))
    throw new Error('receipt_prefix');
  for (const field of ['apiOrigin', 'downloadOrigin', 's3Origin']) {
    const parsed = new URL(value[field]);
    if (
      parsed.protocol !== 'https:' ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash ||
      parsed.username ||
      parsed.password ||
      parsed.port
    )
      throw new Error(`receipt_${field}`);
  }
  const result = {
    ...value,
    archive: objectRef(value.archive, 'archive'),
    manifest: objectRef(value.manifest, 'manifest'),
    provenance: objectRef(value.provenance, 'provenance'),
  };
  if (result.prefix !== `notification-worker/v1/${result.sourceCommit}/${result.archive.sha256}/`)
    throw new Error('receipt_prefix_identity');
  if (new Set([result.archive.fileId, result.manifest.fileId, result.provenance.fileId]).size !== 3)
    throw new Error('receipt_duplicate_fileId');
  if (
    new Set([result.archive.fileName, result.manifest.fileName, result.provenance.fileName])
      .size !== 3
  )
    throw new Error('receipt_duplicate_fileName');
  for (const [field, wanted] of Object.entries(expected)) {
    if (wanted !== undefined && result[field] !== wanted) throw new Error(`expected_${field}`);
  }
  return result;
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortValue(value[key])]),
    );
  return value;
}

export function canonicalReceiptBytes(value, expected = {}) {
  return Buffer.from(`${JSON.stringify(sortValue(validatePublicationReceipt(value, expected)))}\n`);
}

export function parseCanonicalReceipt(bytes, expected = {}) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  const text = bytes.toString('utf8');
  if (Buffer.byteLength(text) !== bytes.length || !text.endsWith('\n'))
    throw new Error('receipt_encoding');
  const parsed = JSON.parse(text);
  const canonical = canonicalReceiptBytes(parsed, expected);
  if (!canonical.equals(bytes)) throw new Error('receipt_noncanonical');
  return parsed;
}

export function sha256Bytes(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}
