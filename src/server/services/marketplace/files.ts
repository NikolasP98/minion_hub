import { createHash, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { marketplaceAgents as agents } from '@minion-stack/db/pg';
import { marketplaceFileLoadState as state } from '$server/db/pg-marketplace-schema';
import { decodeGitHubFile, githubJson, mapGitHubPage, MarketplaceGitHubError } from './github';
import { limitCatalogTransaction } from './sync';
import { MarketplaceLeaseLost, type CatalogDb, type MarketplaceAgentRecord } from './types';

export class MarketplaceDocumentsUnavailable extends Error {
  constructor(
    readonly code: string,
    readonly retryAfterSeconds = 60,
  ) {
    super('Agent documents are temporarily unavailable');
  }
}
export type MarketplaceAgentWithFiles = MarketplaceAgentRecord & {
  documentState: 'ready' | 'stale';
  documentErrorCode?: string;
  retryAfterSeconds?: number;
};
const files = [
  ['SOUL.md', 'soulMd'],
  ['IDENTITY.md', 'identityMd'],
  ['USER.md', 'userMd'],
  ['CONTEXT.md', 'contextMd'],
  ['SKILLS.md', 'skillsMd'],
] as const;
type FileFields = Record<(typeof files)[number][1], string | null>;
const hasOldContent = (agent: MarketplaceAgentRecord) =>
  agent.filesLoadedAt !== null || files.some(([, field]) => agent[field] !== null);
// A legacy instance may still write its unsafe loaded marker during rollout.
// Only a digest published by the new leased writer certifies these exact bytes.
function documentDigest(agent: MarketplaceAgentRecord, fields: FileFields = agent) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        agent.id,
        agent.version,
        agent.githubPath,
        ...files.map(([, field]) => fields[field]),
      ]),
    )
    .digest('hex');
}
function hasVerifiedDocuments(
  agent: MarketplaceAgentRecord,
  load: { verifiedAt: Date | null; verifiedDigest: string | null } | null,
) {
  return (
    !!agent.filesLoadedAt && !!load?.verifiedAt && load.verifiedDigest === documentDigest(agent)
  );
}
async function readDocumentSnapshot(db: CatalogDb, id: string) {
  const [snapshot] = await db
    .select({ agent: agents, load: state })
    .from(agents)
    .leftJoin(state, eq(state.agentId, agents.id))
    .where(eq(agents.id, id))
    .limit(1);
  return snapshot;
}
const owned = (id: string, token: string) =>
  and(
    eq(state.agentId, id),
    eq(state.leaseToken, token),
    sql`${state.leaseUntil} > clock_timestamp()`,
  );
const sameVersion = (a: MarketplaceAgentRecord, b: MarketplaceAgentRecord) =>
  a.version === b.version &&
  a.githubPath === b.githubPath &&
  a.updatedAt.getTime() === b.updatedAt.getTime();
const retrySeconds = (until: Date | null, now: Date) =>
  Math.max(
    1,
    Math.min(60, Math.ceil(((until?.getTime() ?? now.getTime()) - now.getTime()) / 1000)),
  );

export async function claimDocumentLoad(db: CatalogDb, id: string) {
  return db.transaction(async (tx) => {
    await limitCatalogTransaction(tx);
    // Every path takes catalog then file-state locks. Metadata invalidation uses
    // the same order, so refresh cannot deadlock with document publication.
    const [agent] = await tx.select().from(agents).where(eq(agents.id, id)).for('update');
    if (!agent) return { missing: true as const };
    await tx.insert(state).values({ agentId: id }).onConflictDoNothing();
    const [load] = await tx.select().from(state).where(eq(state.agentId, id)).for('update');
    if (hasVerifiedDocuments(agent, load)) return { ready: agent };
    const [{ now }] = await tx
      .select({ now: sql<string>`clock_timestamp()::text` })
      .from(state)
      .where(eq(state.agentId, id));
    const clock = new Date(now);
    const retryAt =
      load.leaseUntil && load.leaseUntil > clock ? load.leaseUntil : load.nextEligibleAt;
    if (retryAt > clock)
      return {
        unavailable: {
          agent,
          verified: !!load.verifiedAt,
          code: load.errorCode ?? 'loading',
          retryAfterSeconds: retrySeconds(retryAt, clock),
        },
      };
    const token = randomUUID();
    await tx
      .update(state)
      .set({
        leaseToken: token,
        leaseUntil: sql`clock_timestamp() + interval '60 seconds'`,
        errorCode: null,
      })
      .where(eq(state.agentId, id));
    return { agent, token, verified: !!load.verifiedAt };
  });
}

export async function publishDocuments(
  db: CatalogDb,
  captured: MarketplaceAgentRecord,
  token: string,
  fields: FileFields,
) {
  return db.transaction(async (tx) => {
    await limitCatalogTransaction(tx);
    const [current] = await tx
      .select()
      .from(agents)
      .where(eq(agents.id, captured.id))
      .for('update');
    if (!current || !sameVersion(current, captured)) throw new MarketplaceLeaseLost();
    const [load] = await tx.select().from(state).where(owned(captured.id, token)).for('update');
    if (!load) throw new MarketplaceLeaseLost();
    const [agent] = await tx
      .update(agents)
      .set({ ...fields, filesLoadedAt: sql`clock_timestamp()` })
      .where(eq(agents.id, captured.id))
      .returning();
    const [released] = await tx
      .update(state)
      .set({
        leaseToken: null,
        leaseUntil: null,
        verifiedAt: sql`clock_timestamp()`,
        verifiedDigest: documentDigest(captured, fields),
        errorCode: null,
        nextEligibleAt: sql`clock_timestamp()`,
      })
      .where(owned(captured.id, token))
      .returning();
    if (!released) throw new MarketplaceLeaseLost();
    return agent;
  });
}
async function failDocuments(
  db: CatalogDb,
  captured: MarketplaceAgentRecord,
  token: string,
  code: string,
) {
  await db.transaction(async (tx) => {
    await limitCatalogTransaction(tx);
    const [current] = await tx
      .select()
      .from(agents)
      .where(eq(agents.id, captured.id))
      .for('update');
    if (!current || !sameVersion(current, captured)) return;
    await tx
      .update(state)
      .set({
        leaseToken: null,
        leaseUntil: null,
        errorCode: code,
        nextEligibleAt: sql`clock_timestamp() + interval '60 seconds'`,
      })
      .where(owned(captured.id, token));
  });
}
async function loadDocuments(db: CatalogDb, id: string): Promise<MarketplaceAgentWithFiles | null> {
  const claim = await claimDocumentLoad(db, id);
  if ('missing' in claim) return null;
  if ('ready' in claim && claim.ready) return { ...claim.ready, documentState: 'ready' };
  if ('unavailable' in claim && claim.unavailable) {
    const { agent, verified, code, retryAfterSeconds } = claim.unavailable;
    if (verified || hasOldContent(agent))
      return { ...agent, documentState: 'stale', documentErrorCode: code, retryAfterSeconds };
    throw new MarketplaceDocumentsUnavailable(code, retryAfterSeconds);
  }
  if (!('agent' in claim) || !claim.agent || !claim.token)
    throw new MarketplaceDocumentsUnavailable('loading');
  const { agent, token } = claim;
  try {
    const signal = AbortSignal.timeout(30_000);
    const results = await mapGitHubPage(files, signal, async ([name, field]) => {
      const path = `${agent.githubPath}/${name}`;
      try {
        return {
          field,
          content: decodeGitHubFile(await githubJson(path, 384 * 1024, signal), path, 256 * 1024),
        };
      } catch (cause) {
        if (cause instanceof MarketplaceGitHubError && cause.code === 'not_found')
          return { field, content: null };
        throw cause;
      }
    });
    const fields: FileFields = {
      soulMd: null,
      identityMd: null,
      userMd: null,
      contextMd: null,
      skillsMd: null,
    };
    let total = 0;
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason;
      fields[result.value.field] = result.value.content;
      total += Buffer.byteLength(result.value.content ?? '', 'utf8');
      if (total > 1024 * 1024) throw new MarketplaceGitHubError('document_too_large');
    }
    return { ...(await publishDocuments(db, agent, token, fields)), documentState: 'ready' };
  } catch (cause) {
    // Database failures are never masked as provider absence or a successfully
    // published bundle. Known failures alone can set this owner's cooldown.
    if (!(cause instanceof MarketplaceGitHubError) && !(cause instanceof MarketplaceLeaseLost)) {
      // A successful publication may lose its database response. Return the
      // canonical ready bundle without replaying provider work or erasing it.
      const canonical = await readDocumentSnapshot(db, id);
      if (canonical && hasVerifiedDocuments(canonical.agent, canonical.load))
        return { ...canonical.agent, documentState: 'ready' };
      throw cause;
    }
    const code = cause instanceof MarketplaceGitHubError ? cause.code : 'catalog_changed';
    await failDocuments(db, agent, token, code);
    const snapshot = await readDocumentSnapshot(db, id);
    if (!snapshot) return null;
    const current = snapshot.agent;
    if (hasVerifiedDocuments(current, snapshot.load)) return { ...current, documentState: 'ready' };
    if (claim.verified || hasOldContent(current))
      return { ...current, documentState: 'stale', documentErrorCode: code, retryAfterSeconds: 60 };
    throw new MarketplaceDocumentsUnavailable(code);
  }
}
const inFlight = new WeakMap<CatalogDb, Map<string, Promise<MarketplaceAgentWithFiles | null>>>();
/** The persisted lease also deduplicates independent request DB wrappers/processes. */
export function getAgentWithFiles(db: CatalogDb, id: string) {
  let loads = inFlight.get(db);
  if (!loads) {
    loads = new Map();
    inFlight.set(db, loads);
  }
  const pending = loads.get(id);
  if (pending) return pending;
  const result = loadDocuments(db, id).finally(() => loads.delete(id));
  loads.set(id, result);
  return result;
}
/** Compatibility entry point: callers asking to populate require a ready bundle. */
export async function populateAgentFiles(db: CatalogDb, id: string): Promise<void> {
  const result = await getAgentWithFiles(db, id);
  if (result?.documentState === 'stale')
    throw new MarketplaceDocumentsUnavailable(
      result.documentErrorCode ?? 'loading',
      result.retryAfterSeconds,
    );
}
