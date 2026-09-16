/**
 * Deterministic identity helpers for the QA seed matrix.
 *
 * Every id, human-readable code, email and password the seed writes is a pure
 * function of the matrix id string, so re-running the seed is a no-op
 * (`ON CONFLICT DO UPDATE` on the same primary key) instead of a duplicate
 * insert. No `uuid` package: `node:crypto` already implements the sha1 this
 * needs, and UUIDv5 is ~15 lines over it.
 */
import { createHash } from 'node:crypto';

/** Fixed namespace for this seed matrix (arbitrary — only needs to be stable). */
const QA_NAMESPACE = '6c9b2b0a-0b1a-4b7a-9c1e-6f7a2b3c4d5e';

function namespaceBytes(namespace: string): Buffer {
  return Buffer.from(namespace.replace(/-/g, ''), 'hex');
}

/** RFC 4122 UUIDv5 (namespace + name, sha1-based). */
export function uuidv5(name: string, namespace: string = QA_NAMESPACE): string {
  const hash = createHash('sha1')
    .update(Buffer.concat([namespaceBytes(namespace), Buffer.from(name, 'utf8')]))
    .digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant RFC 4122
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Deterministic uuid for one matrix id. Pass `salt` to derive a second (third,
 * …) related row off the same matrix id without collision, e.g. a ticket's
 * line items: `matrixUuid('pos.ticket.voided', 'line-1')`.
 */
export function matrixUuid(matrixId: string, salt?: string): string {
  return uuidv5(salt ? `${matrixId}::${salt}` : matrixId);
}

/** Deterministic short text id (for tables with a text/cuid primary key). */
export function matrixTextId(matrixId: string, salt?: string): string {
  return `qa_${matrixUuid(matrixId, salt).replace(/-/g, '')}`;
}

/**
 * Human-readable code embedding the matrix id, so a UI test (or a human
 * clicking around) can find the fixture by what's on screen. Truncated to a
 * generous but bounded length — several catalog/human_id columns are short
 * text without a declared max, but keeping this sane avoids surprises.
 */
export function humanId(prefix: string, matrixId: string): string {
  const slug = matrixId
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase();
  return `${prefix}-${slug}`.slice(0, 60);
}

/** Fixed persona email for a matrix user id, e.g. `tenancy.user.owner` -> `tenancy.user.owner@qa.minion.test`. */
export function personaEmail(matrixId: string): string {
  return `${matrixId}@qa.minion.test`;
}

/** One password for every QA persona this run — simplest thing that works for
 *  a disposable, non-production stack; override via QA_SEED_PASSWORD. */
export const QA_PASSWORD = process.env.QA_SEED_PASSWORD ?? 'QaStack!2026';
