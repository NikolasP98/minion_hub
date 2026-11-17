/**
 * Deterministic identity helpers for the QA seed matrix.
 *
 * Every id, human-readable code, email and password the seed writes is a pure
 * function of the matrix id string, so re-running the seed is a no-op
 * (`ON CONFLICT DO UPDATE` on the same primary key) instead of a duplicate
 * insert. No `uuid` package: `node:crypto` already implements the sha1 this
 * needs, and UUIDv5 is ~15 lines over it.
 */
import { uuidv5 as uuidv5Shared } from '../../../src/server/utils/uuid-v5';

/** Fixed namespace for this seed matrix (arbitrary — only needs to be stable). */
const QA_NAMESPACE = '6c9b2b0a-0b1a-4b7a-9c1e-6f7a2b3c4d5e';

/** RFC 4122 UUIDv5 with this seed matrix's default namespace; the algorithm lives in the shared util. */
export function uuidv5(name: string, namespace: string = QA_NAMESPACE): string {
  return uuidv5Shared(name, namespace);
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

/** Stable replay namespace for Pulse decision/dispatch fixture rows. */
export const pulseFixtureId = (scenario: string, kind = 'proposal') =>
  matrixUuid(`pulse.${scenario}`, kind);
export const digestFixtureId = (scenario: string, kind = 'run') =>
  matrixUuid(`pulse.digest.${scenario}`, kind);
